/**
 * Pure restart-policy maths for the agent supervisor (PDD §28). Kept separate
 * from the process plumbing so the backoff ladder and the rolling-window
 * give-up rule are exhaustively unit-tested with a table, no child processes.
 */

export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_CAP_MS = 30_000;
export const DEFAULT_MAX_RESTARTS = 5;
export const DEFAULT_RESTART_WINDOW_MS = 60_000;

/**
 * Delay before restart attempt `attempt` (0-based): 0.5 s, 1, 2, 4, 8, … each
 * doubling, capped at 30 s (PDD §28: `500ms·2ⁿ, cap 30s`).
 */
export function computeBackoffDelay(
  attempt: number,
  baseMs = DEFAULT_BACKOFF_BASE_MS,
  capMs = DEFAULT_BACKOFF_CAP_MS,
): number {
  const exponent = Math.max(0, attempt);
  const delay = baseMs * 2 ** exponent;
  return Math.min(capMs, Math.max(baseMs, delay));
}

/**
 * Rolling-window restart counter. Records each restart timestamp and reports
 * whether the agent is restarting too fast to be worth retrying (PDD §28:
 * `> 5 restarts in rolling 60 s → failed`; M5: the 6th restart in 60 s fails).
 */
export class RestartTracker {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRestarts: number = DEFAULT_MAX_RESTARTS,
    private readonly windowMs: number = DEFAULT_RESTART_WINDOW_MS,
  ) {}

  /**
   * Record a restart at `now`. Returns true if it is within budget, false if
   * this restart pushes the count over the limit inside the window (→ failed).
   */
  record(now: number): boolean {
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    this.timestamps.push(now);
    return this.timestamps.length <= this.maxRestarts;
  }

  reset(): void {
    this.timestamps = [];
  }

  get count(): number {
    return this.timestamps.length;
  }
}
