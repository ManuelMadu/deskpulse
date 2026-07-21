import {
  DeskPulseError,
  ERROR_CODES,
  LIMITS,
  monitorConfigInputSchema,
} from '@deskpulse/contracts';

import { uuidv7 } from '../uuid.js';
import { MonitorStateMachine } from './health-state.js';
import { probeOnce } from './probe.js';

import type { ProbeFn, ProbeSpec } from './probe.js';
import type { EventBus } from '../events.js';
import type {
  MonitorConfigInput,
  MonitorPatch,
  MonitorWithStatus,
  ProbeResult,
} from '@deskpulse/contracts';

const RESULT_HISTORY = 100; // in-memory per monitor (FR-13)
const MAX_JITTER_MS = 2_000; // avoid a thundering herd on startup (§25)
const SKIP_WARN_THRESHOLD = 3;

interface MonitorRuntime {
  config: MonitorWithStatus;
  machine: MonitorStateMachine;
  jitterTimer: NodeJS.Timeout | undefined;
  intervalTimer: NodeJS.Timeout | undefined;
  inFlight: boolean;
  consecutiveSkips: number;
}

export interface HealthRegistryOptions {
  probe?: ProbeFn;
  now?: () => number;
  /** Test seam: fixed (or zero) startup jitter for determinism. */
  jitterMs?: number;
  /** Test seam: override every monitor's interval (config enforces ≥ 5 s). */
  intervalMsOverride?: number;
}

/**
 * Owns the monitor set (max 20) and their independent schedulers (PDD §25).
 * A slow probe never delays other monitors — each has its own timer — and an
 * overlapping tick for the same monitor is skipped rather than queued, so at
 * most one probe per monitor is ever in flight.
 */
export class HealthRegistry {
  private readonly monitors = new Map<string, MonitorRuntime>();
  private readonly probe: ProbeFn;
  private readonly now: () => number;
  private readonly jitterMs: number | undefined;
  private readonly intervalMsOverride: number | undefined;

  constructor(
    private readonly bus: EventBus,
    options: HealthRegistryOptions = {},
  ) {
    this.probe = options.probe ?? probeOnce;
    this.now = options.now ?? Date.now;
    this.jitterMs = options.jitterMs;
    this.intervalMsOverride = options.intervalMsOverride;
  }

  get activeCount(): number {
    return this.monitors.size;
  }

  list(): MonitorWithStatus[] {
    return [...this.monitors.values()].map((rt) => cloneStatus(rt.config));
  }

  add(input: MonitorConfigInput): MonitorWithStatus {
    if (this.monitors.size >= LIMITS.maxMonitors) {
      throw new DeskPulseError({
        code: ERROR_CODES.LIMIT_REACHED,
        message: `At most ${LIMITS.maxMonitors} monitors are allowed.`,
        retryable: false,
      });
    }
    const id = uuidv7();
    const config: MonitorWithStatus = {
      id,
      ...input,
      state: 'unknown',
      consecutiveFailures: 0,
      recentResults: [],
    };
    const rt: MonitorRuntime = {
      config,
      machine: new MonitorStateMachine(input),
      jitterTimer: undefined,
      intervalTimer: undefined,
      inFlight: false,
      consecutiveSkips: 0,
    };
    this.monitors.set(id, rt);
    if (config.enabled) {
      this.schedule(rt);
    }
    return cloneStatus(config);
  }

  update(id: string, patch: MonitorPatch): MonitorWithStatus {
    const rt = this.monitors.get(id);
    if (!rt) {
      throw new DeskPulseError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'No such monitor.',
        retryable: false,
      });
    }
    const wasEnabled = rt.config.enabled;
    const resets =
      (patch.url !== undefined && patch.url !== rt.config.url) ||
      (patch.method !== undefined && patch.method !== rt.config.method) ||
      (patch.expectedStatus !== undefined &&
        (patch.expectedStatus.min !== rt.config.expectedStatus.min ||
          patch.expectedStatus.max !== rt.config.expectedStatus.max));

    Object.assign(rt.config, patch);

    if (resets) {
      rt.machine.reset();
      rt.config.state = 'unknown';
      rt.config.consecutiveFailures = 0;
      rt.config.recentResults = [];
      rt.config.lastResult = undefined;
    }

    // Toggling enabled starts/stops the timer; other changes take effect on
    // the next scheduled probe (re-arm to pick up a new interval).
    this.unschedule(rt);
    if (rt.config.enabled) {
      this.schedule(rt);
    } else if (wasEnabled) {
      rt.inFlight = false;
    }
    return cloneStatus(rt.config);
  }

  remove(id: string): boolean {
    const rt = this.monitors.get(id);
    if (!rt) {
      return false;
    }
    this.unschedule(rt);
    this.monitors.delete(id);
    return true;
  }

  closeAll(): void {
    for (const rt of this.monitors.values()) {
      this.unschedule(rt);
    }
    this.monitors.clear();
  }

  private schedule(rt: MonitorRuntime): void {
    const intervalMs = this.intervalMsOverride ?? rt.config.intervalSeconds * 1_000;
    const jitter = this.jitterMs ?? Math.floor(Math.random() * MAX_JITTER_MS);
    rt.jitterTimer = setTimeout(() => {
      rt.jitterTimer = undefined;
      this.tick(rt);
      rt.intervalTimer = setInterval(() => this.tick(rt), intervalMs);
      rt.intervalTimer.unref();
    }, jitter);
    rt.jitterTimer.unref();
  }

  private unschedule(rt: MonitorRuntime): void {
    if (rt.jitterTimer) {
      clearTimeout(rt.jitterTimer);
      rt.jitterTimer = undefined;
    }
    if (rt.intervalTimer) {
      clearInterval(rt.intervalTimer);
      rt.intervalTimer = undefined;
    }
  }

  private tick(rt: MonitorRuntime): void {
    if (rt.inFlight) {
      rt.consecutiveSkips += 1;
      if (rt.consecutiveSkips === SKIP_WARN_THRESHOLD) {
        this.bus.publish({
          type: 'agent.warning',
          code: 'probe-overlap',
          message: `Monitor "${rt.config.name}" is slower than its interval; consider a longer interval.`,
          context: { monitorId: rt.config.id },
        });
      }
      return;
    }
    rt.consecutiveSkips = 0;
    void this.runProbe(rt);
  }

  private async runProbe(rt: MonitorRuntime): Promise<void> {
    rt.inFlight = true;
    const now = this.now();
    const spec: ProbeSpec = {
      url: rt.config.url,
      method: rt.config.method,
      timeoutMs: rt.config.timeoutMs,
      expectedStatus: rt.config.expectedStatus,
    };

    let result: ProbeResult;
    try {
      result = await this.probe(spec, now);
    } catch {
      result = { at: new Date(now).toISOString(), ok: false, reason: 'aborted' };
    } finally {
      rt.inFlight = false;
    }

    // A monitor removed or disabled mid-probe should not record late results.
    if (!this.monitors.has(rt.config.id) || !rt.config.enabled) {
      return;
    }

    rt.config.recentResults.push(result);
    if (rt.config.recentResults.length > RESULT_HISTORY) {
      rt.config.recentResults.shift();
    }
    rt.config.lastResult = result;

    const transition = rt.machine.record(result.ok, now);
    rt.config.state = rt.machine.state;
    rt.config.consecutiveFailures = rt.machine.failures;

    this.bus.publish({
      type: 'monitor.result',
      monitorId: rt.config.id,
      at: result.at,
      ok: result.ok,
      ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
    });

    if (transition.kind === 'became-unhealthy') {
      this.bus.publish({
        type: 'monitor.unhealthy',
        monitorId: rt.config.id,
        name: rt.config.name,
        at: result.at,
        consecutiveFailures: transition.consecutiveFailures,
        ...(result.reason !== undefined ? { lastReason: result.reason } : {}),
      });
    } else if (transition.kind === 'became-healthy') {
      this.bus.publish({
        type: 'monitor.recovered',
        monitorId: rt.config.id,
        name: rt.config.name,
        at: result.at,
        downtimeSeconds: Math.max(0, (now - transition.downFrom) / 1_000),
      });
    }
  }
}

/** Parse-and-default a raw config for `add` (used by the HTTP route). */
export function parseMonitorInput(raw: unknown): MonitorConfigInput {
  return monitorConfigInputSchema.parse(raw);
}

function cloneStatus(config: MonitorWithStatus): MonitorWithStatus {
  return {
    ...config,
    expectedStatus: { ...config.expectedStatus },
    recentResults: config.recentResults.slice(),
    ...(config.lastResult ? { lastResult: { ...config.lastResult } } : {}),
  };
}
