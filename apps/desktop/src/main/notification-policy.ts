/**
 * Notification policy (PDD §25, FR-12): monitor *transitions* are the only
 * thing worth interrupting the user for, and a burst of them (e.g. every
 * monitor flapping on machine wake) collapses into a single summary rather
 * than a wall of banners.
 *
 * Pure and timer-injectable so the coalescing is unit-tested with a fake
 * clock. Transitions are buffered for `coalesceWindowMs`; when the window
 * closes, ≤ `coalesceThreshold` transitions fire individually and anything
 * beyond that becomes one summary.
 */

export type TransitionKind = 'unhealthy' | 'recovered';

export interface MonitorTransition {
  kind: TransitionKind;
  monitorId: string;
  name: string;
}

export type NotificationRequest =
  | { kind: 'single'; transition: MonitorTransition }
  | { kind: 'summary'; unhealthy: number; recovered: number; total: number };

interface TimerFns {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface NotificationPolicyOptions {
  emit: (request: NotificationRequest) => void;
  /** How long to gather transitions before deciding (PDD §25: 5 s). */
  coalesceWindowMs?: number | undefined;
  /** More than this many within the window collapses into one summary. */
  coalesceThreshold?: number | undefined;
  timer?: TimerFns | undefined;
}

const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_THRESHOLD = 3;

const realTimer: TimerFns = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle),
};

export class NotificationPolicy {
  private readonly emit: (request: NotificationRequest) => void;
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly timer: TimerFns;
  private buffer: MonitorTransition[] = [];
  private flushHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(options: NotificationPolicyOptions) {
    this.emit = options.emit;
    this.windowMs = options.coalesceWindowMs ?? DEFAULT_WINDOW_MS;
    this.threshold = options.coalesceThreshold ?? DEFAULT_THRESHOLD;
    this.timer = options.timer ?? realTimer;
  }

  /** Record a transition; the notification (or a coalesced summary) fires when
   * the current window closes. */
  record(transition: MonitorTransition): void {
    this.buffer.push(transition);
    if (this.flushHandle === undefined) {
      this.flushHandle = this.timer.set(() => this.flush(), this.windowMs);
    }
  }

  /** Drop any pending window without emitting (app quit / teardown). */
  dispose(): void {
    if (this.flushHandle !== undefined) {
      this.timer.clear(this.flushHandle);
      this.flushHandle = undefined;
    }
    this.buffer = [];
  }

  private flush(): void {
    this.flushHandle = undefined;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) {
      return;
    }
    if (batch.length <= this.threshold) {
      for (const transition of batch) {
        this.emit({ kind: 'single', transition });
      }
      return;
    }
    const unhealthy = batch.filter((t) => t.kind === 'unhealthy').length;
    this.emit({
      kind: 'summary',
      unhealthy,
      recovered: batch.length - unhealthy,
      total: batch.length,
    });
  }
}
