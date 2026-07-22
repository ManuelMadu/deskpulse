import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { agentReadyHandshakeSchema, healthResponseSchema } from '@deskpulse/contracts';

import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_WINDOW_MS,
  RestartTracker,
  computeBackoffDelay,
} from './agent-restart-policy.js';

import type { AgentReadyHandshake, AgentStatus } from '@deskpulse/contracts';
import type { ChildProcess } from 'node:child_process';

/**
 * Agent supervisor (PDD §28). `start()`/`stop()` are the single-attempt
 * primitives (spawn, readiness handshake, health confirm, graceful kill). The
 * supervised layer on top — `launch()`, `restart()` and the exit watcher —
 * grows the full state machine: crash → backoff ladder → respawn, a rolling
 * window that trips `failed` after too many restarts, and a stable-running
 * reset. Every state change is pushed through `onStateChange` so the sidebar
 * pill, tray icon, and crash-recovery banner stay live.
 *
 * Deliberately Electron-free: bundle path, env, timers, and clock are all
 * injected, so the whole class is exercised against the real agent bundle
 * under plain Node.
 */

export const HANDSHAKE_DEADLINE_MS = 10_000;
export const STOP_KILL_TIMEOUT_MS = 5_000;
export const DEFAULT_STABLE_RESET_MS = 60_000;

export type SupervisorState =
  'idle' | 'spawning' | 'running' | 'stopping' | 'stopped' | 'backoff' | 'failed';

export interface AgentHandle {
  port: number;
  pid: number;
  version: string;
  /** Per-spawn 256-bit token. Never logged, never sent to the renderer. */
  token: string;
}

export type StartFailureKind = 'spawn-error' | 'early-exit' | 'handshake-timeout' | 'health-failed';

export class AgentStartError extends Error {
  constructor(
    readonly kind: StartFailureKind,
    message: string,
    readonly exitCode?: number | null,
  ) {
    super(message);
    this.name = 'AgentStartError';
  }
}

/** Parse one stdout line as the ready handshake; null for anything else. */
export function parseHandshakeLine(line: string): AgentReadyHandshake | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = agentReadyHandshakeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** SIGTERM, then SIGKILL after `timeoutMs` if the process is still alive. */
export async function killProcessGracefully(
  child: ChildProcess,
  timeoutMs: number,
): Promise<'exited' | 'killed'> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return 'exited';
  }
  return new Promise((resolve) => {
    let killed = false;
    const killTimer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve(killed ? 'killed' : 'exited');
    });
    child.kill('SIGTERM');
  });
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SupervisorOptions {
  bundlePath: string;
  /** The executable to run the bundle with (Electron binary or node). */
  execPath: string;
  /** Extra env merged over the minimal safe set. */
  env?: Record<string, string>;
  handshakeDeadlineMs?: number;
  stopKillTimeoutMs?: number;
  /** Restart tuning (PDD §28); defaults match the spec. */
  backoffBaseMs?: number;
  backoffCapMs?: number;
  maxRestarts?: number;
  restartWindowMs?: number;
  stableResetMs?: number;
  /** Pushed on every supervisor state change (running/backoff/failed/…). */
  onStateChange?: (status: AgentStatus) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  log: (level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>) => void;
}

export class AgentSupervisor {
  private child: ChildProcess | undefined;
  private handle: AgentHandle | undefined;
  private stateValue: SupervisorState = 'idle';

  // Supervised-restart state.
  private stopping = false;
  private restartAttempt = 0;
  private restartInfo: AgentStatus['restart'];
  private watchedChild: ChildProcess | undefined;
  private backoffTimer: TimerHandle | undefined;
  private stableTimer: TimerHandle | undefined;
  private readonly tracker: RestartTracker;

  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly maxRestarts: number;
  private readonly stableResetMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(private readonly options: SupervisorOptions) {
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffCapMs = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.stableResetMs = options.stableResetMs ?? DEFAULT_STABLE_RESET_MS;
    this.now = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        // unref so a pending backoff/stable timer never holds the process open
        // (the Electron app stays alive on its own; tests can exit cleanly).
        const handle = setTimeout(fn, ms);
        handle.unref?.();
        return handle;
      });
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.tracker = new RestartTracker(
      this.maxRestarts,
      options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS,
    );
  }

  get state(): SupervisorState {
    return this.stateValue;
  }

  get currentHandle(): AgentHandle | undefined {
    return this.handle;
  }

  /** The renderer-facing status snapshot (state + pid/version + restart info). */
  status(): AgentStatus {
    const status: AgentStatus = { state: this.stateValue };
    if (this.handle) {
      status.pid = this.handle.pid;
      status.version = this.handle.version;
    }
    if (this.restartInfo) {
      status.restart = this.restartInfo;
    }
    return status;
  }

  /**
   * Supervised entry point: start the agent and keep it alive, restarting with
   * backoff on unexpected exit. Never rejects — failures become `backoff`/
   * `failed` state, not thrown errors (unlike the low-level `start()`).
   */
  async launch(): Promise<void> {
    this.stopping = false;
    await this.attempt();
  }

  /** Manual "Restart agent" (PDD §7/§28): clear the ladder and try immediately. */
  async restart(): Promise<void> {
    this.clearTimers();
    this.tracker.reset();
    this.restartAttempt = 0;
    this.restartInfo = undefined;
    if (this.child) {
      await this.stop();
    }
    this.stopping = false;
    await this.attempt();
  }

  private async attempt(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.setState('spawning');
    try {
      await this.start();
    } catch (error) {
      this.options.log('warn', 'agent start attempt failed', { cause: String(error) });
      this.scheduleRestart();
      return;
    }
    this.restartInfo = undefined;
    this.setState('running');
    this.watchExit();
    this.startStableTimer();
  }

  private watchExit(): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.watchedChild = child;
    const onExit = (): void => {
      if (this.watchedChild === child) {
        this.onUnexpectedExit();
      }
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      // Died in the gap between health confirmation and attaching the watcher.
      queueMicrotask(onExit);
      return;
    }
    child.once('exit', onExit);
  }

  private onUnexpectedExit(): void {
    if (this.stopping) {
      return;
    }
    this.options.log('warn', 'agent exited unexpectedly; scheduling restart', {
      pid: this.handle?.pid,
    });
    this.clearStableTimer();
    this.child = undefined;
    this.handle = undefined;
    this.watchedChild = undefined;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    this.clearStableTimer();
    const withinBudget = this.tracker.record(this.now());
    this.restartAttempt += 1;
    if (!withinBudget) {
      this.restartInfo = { attempt: this.restartAttempt, maxAttempts: this.maxRestarts };
      this.options.log('error', 'agent restart budget exhausted; entering failed state', {
        restarts: this.tracker.count,
      });
      this.setState('failed');
      return;
    }
    const delay = computeBackoffDelay(
      this.restartAttempt - 1,
      this.backoffBaseMs,
      this.backoffCapMs,
    );
    this.restartInfo = {
      attempt: this.restartAttempt,
      maxAttempts: this.maxRestarts,
      nextRetryAtMs: this.now() + delay,
    };
    this.setState('backoff');
    this.backoffTimer = this.setTimer(() => {
      this.backoffTimer = undefined;
      void this.attempt();
    }, delay);
  }

  private startStableTimer(): void {
    this.clearStableTimer();
    this.stableTimer = this.setTimer(() => {
      this.stableTimer = undefined;
      this.restartAttempt = 0;
      this.tracker.reset();
      this.restartInfo = undefined;
      this.options.log('info', 'agent stable; restart ladder reset');
    }, this.stableResetMs);
  }

  private clearBackoffTimer(): void {
    if (this.backoffTimer !== undefined) {
      this.clearTimer(this.backoffTimer);
      this.backoffTimer = undefined;
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== undefined) {
      this.clearTimer(this.stableTimer);
      this.stableTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearBackoffTimer();
    this.clearStableTimer();
  }

  private setState(state: SupervisorState): void {
    this.stateValue = state;
    this.options.onStateChange?.(this.status());
  }

  async start(): Promise<AgentHandle> {
    if (this.stateValue === 'running' || this.stateValue === 'spawning') {
      // Re-entrant guard only for direct callers; the supervised path sets
      // 'spawning' itself, so allow that transition through.
      if (this.child) {
        throw new Error(`cannot start agent from state ${this.stateValue}`);
      }
    }
    this.stateValue = 'spawning';
    const token = randomBytes(32).toString('hex');
    const deadline = this.options.handshakeDeadlineMs ?? HANDSHAKE_DEADLINE_MS;
    const startedAt = Date.now();

    const child = spawn(this.options.execPath, [this.options.bundlePath], {
      env: {
        // Minimal env, never the parent's full set: PATH/HOME/TMPDIR for the
        // agent's own needs, ELECTRON_RUN_AS_NODE for the Electron binary,
        // and the per-spawn token (env, never argv — PDD §19, §28).
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        TMPDIR: process.env['TMPDIR'] ?? '',
        ELECTRON_RUN_AS_NODE: '1',
        DESKPULSE_AGENT_TOKEN: token,
        ...this.options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      this.options.log('warn', 'agent stderr', { text: chunk.toString('utf8').slice(0, 512) });
    });

    try {
      const handshake = await this.waitForHandshake(child, deadline);
      const remaining = Math.max(500, deadline - (Date.now() - startedAt));
      await this.confirmHealth(handshake.port, token, remaining);

      this.handle = { port: handshake.port, pid: handshake.pid, version: handshake.version, token };
      this.stateValue = 'running';
      this.options.log('info', 'agent running', {
        port: handshake.port,
        pid: handshake.pid,
        version: handshake.version,
        startupMs: Date.now() - startedAt,
      });
      return this.handle;
    } catch (error) {
      await killProcessGracefully(child, 1_000);
      this.child = undefined;
      this.stateValue = 'stopped';
      throw error;
    }
  }

  private waitForHandshake(child: ChildProcess, deadlineMs: number): Promise<AgentReadyHandshake> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const finish = (outcome: () => void): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          outcome();
        }
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(new AgentStartError('handshake-timeout', `no handshake within ${deadlineMs}ms`)),
        );
      }, deadlineMs);

      child.once('error', (error) => {
        finish(() =>
          reject(new AgentStartError('spawn-error', `agent spawn failed: ${error.message}`)),
        );
      });

      child.once('exit', (code) => {
        finish(() =>
          reject(
            new AgentStartError(
              'early-exit',
              `agent exited before handshake (code ${String(code)})`,
              code,
            ),
          ),
        );
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const handshake = parseHandshakeLine(line);
          if (handshake) {
            finish(() => resolve(handshake));
            return;
          }
          this.options.log('info', 'agent stdout (non-handshake)', { line: line.slice(0, 256) });
          newline = buffer.indexOf('\n');
        }
      });
    });
  }

  private async confirmHealth(port: number, token: string, timeoutMs: number): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new AgentStartError('health-failed', `health request failed: ${String(error)}`);
    }
    if (response.status !== 200) {
      throw new AgentStartError('health-failed', `health returned ${response.status}`);
    }
    const body: unknown = await response.json();
    const parsed = healthResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AgentStartError('health-failed', 'health response failed contract validation');
    }
  }

  /** SIGTERM the agent; SIGKILL if it hasn't exited within the timeout. */
  async stop(): Promise<void> {
    // Intentional stop: cancel any pending restart and block the exit watcher.
    this.stopping = true;
    this.clearTimers();
    this.watchedChild = undefined;
    const child = this.child;
    if (!child || this.stateValue === 'stopped' || this.stateValue === 'idle') {
      this.stateValue = 'stopped';
      this.handle = undefined;
      return;
    }
    this.stateValue = 'stopping';
    const outcome = await killProcessGracefully(
      child,
      this.options.stopKillTimeoutMs ?? STOP_KILL_TIMEOUT_MS,
    );
    this.options.log(outcome === 'exited' ? 'info' : 'warn', `agent stop: ${outcome}`, {
      pid: child.pid,
    });
    this.child = undefined;
    this.handle = undefined;
    this.stateValue = 'stopped';
  }
}
