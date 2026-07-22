import { describe, expect, it, vi } from 'vitest';

import { startOrphanGuard } from './orphan-guard.js';

/** Capture the interval callback so the test can tick it deterministically. */
function manualInterval() {
  let fn: () => void = () => undefined;
  const handle = setInterval(() => undefined, 1_000_000);
  handle.unref();
  return {
    tick: (): void => fn(),
    setIntervalFn: (callback: () => void) => {
      fn = callback;
      return handle;
    },
    clearIntervalFn: (): void => clearInterval(handle),
  };
}

describe('startOrphanGuard', () => {
  it('self-terminates when the parent goes away (ppid → 1)', () => {
    let ppid = 4242;
    const onOrphaned = vi.fn();
    const timer = manualInterval();
    const stop = startOrphanGuard({
      onOrphaned,
      getPpid: () => ppid,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn: timer.clearIntervalFn,
    });

    timer.tick();
    expect(onOrphaned).not.toHaveBeenCalled();

    ppid = 1; // Main died; the OS reparented us to launchd.
    timer.tick();
    expect(onOrphaned).toHaveBeenCalledOnce();

    // Never fires twice, even if more ticks land before the process exits.
    timer.tick();
    expect(onOrphaned).toHaveBeenCalledOnce();

    stop();
  });

  it('does not arm when already parentless at startup', () => {
    const onOrphaned = vi.fn();
    const setIntervalFn = vi.fn();
    startOrphanGuard({ onOrphaned, getPpid: () => 1, setIntervalFn });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(onOrphaned).not.toHaveBeenCalled();
  });

  it('stop() cancels the guard', () => {
    const clearIntervalFn = vi.fn();
    const timer = manualInterval();
    const stop = startOrphanGuard({
      onOrphaned: vi.fn(),
      getPpid: () => 4242,
      setIntervalFn: timer.setIntervalFn,
      clearIntervalFn,
    });
    stop();
    expect(clearIntervalFn).toHaveBeenCalledOnce();
    timer.clearIntervalFn();
  });
});
