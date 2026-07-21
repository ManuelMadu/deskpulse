import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { agentReadyHandshakeSchema, healthResponseSchema } from '@deskpulse/contracts';

import type { AgentReadyHandshake } from '@deskpulse/contracts';
import type { ChildProcess } from 'node:child_process';

/**
 * Agent supervisor — happy path (DP-7): spawn, readiness handshake, health
 * confirmation, graceful stop. Backoff/restart arrives in Phase 7 (PDD §28).
 *
 * Deliberately Electron-free: the bundle path and env come from the caller,
 * so the whole class is exercised in tests against the real agent bundle
 * under plain Node.
 */

export const HANDSHAKE_DEADLINE_MS = 10_000;
export const STOP_KILL_TIMEOUT_MS = 5_000;

export type SupervisorState = 'idle' | 'spawning' | 'running' | 'stopping' | 'stopped';

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

export interface SupervisorOptions {
  bundlePath: string;
  /** The executable to run the bundle with (Electron binary or node). */
  execPath: string;
  /** Extra env merged over the minimal safe set. */
  env?: Record<string, string>;
  handshakeDeadlineMs?: number;
  stopKillTimeoutMs?: number;
  log: (level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>) => void;
}

export class AgentSupervisor {
  private child: ChildProcess | undefined;
  private handle: AgentHandle | undefined;
  private stateValue: SupervisorState = 'idle';

  constructor(private readonly options: SupervisorOptions) {}

  get state(): SupervisorState {
    return this.stateValue;
  }

  get currentHandle(): AgentHandle | undefined {
    return this.handle;
  }

  async start(): Promise<AgentHandle> {
    if (this.stateValue === 'running' || this.stateValue === 'spawning') {
      throw new Error(`cannot start agent from state ${this.stateValue}`);
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
    const child = this.child;
    if (!child || this.stateValue === 'stopped' || this.stateValue === 'idle') {
      this.stateValue = 'stopped';
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
