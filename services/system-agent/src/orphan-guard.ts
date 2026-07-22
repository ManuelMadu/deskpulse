/**
 * Orphan guard (PDD §28) — belt-and-braces against a leaked agent. The
 * supervisor SIGTERMs the agent on a clean quit, but if Main dies *ungracefully*
 * (crash, `kill -9`) no signal arrives. The OS then reparents this process to
 * launchd (ppid 1), so we poll ppid and self-terminate when that happens.
 *
 * Pure and fully injectable (ppid source + timer) so it is unit-tested without
 * actually orphaning a process.
 */

export const ORPHAN_CHECK_INTERVAL_MS = 5_000;

type IntervalHandle = ReturnType<typeof setInterval>;

export interface OrphanGuardOptions {
  /** Called once when the parent is detected gone; typically exits the process. */
  onOrphaned: () => void;
  getPpid?: () => number;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => IntervalHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

/** Begin watching; returns a stop() that cancels the guard. */
export function startOrphanGuard(options: OrphanGuardOptions): () => void {
  const getPpid = options.getPpid ?? ((): number => process.ppid);
  const setIntervalFn = options.setIntervalFn ?? ((fn, ms): IntervalHandle => setInterval(fn, ms));
  const clearIntervalFn =
    options.clearIntervalFn ?? ((handle: IntervalHandle): void => clearInterval(handle));
  const intervalMs = options.intervalMs ?? ORPHAN_CHECK_INTERVAL_MS;

  if (getPpid() === 1) {
    // Already parentless (e.g. launched directly by init) — Main death is not
    // detectable this way, so don't arm the guard.
    return () => undefined;
  }

  let fired = false;
  const timer = setIntervalFn(() => {
    if (fired || getPpid() !== 1) {
      return;
    }
    fired = true;
    options.log?.('parent process gone (reparented to launchd); self-terminating');
    options.onOrphaned();
  }, intervalMs);
  timer.unref?.();

  return () => clearIntervalFn(timer);
}
