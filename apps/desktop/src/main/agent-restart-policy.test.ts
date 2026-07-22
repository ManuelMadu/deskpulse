import { describe, expect, it } from 'vitest';

import { RestartTracker, computeBackoffDelay } from './agent-restart-policy.js';

describe('computeBackoffDelay', () => {
  it('doubles from 500 ms and caps at 30 s', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => computeBackoffDelay(n));
    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('never returns below the base and honors custom base/cap', () => {
    expect(computeBackoffDelay(-5)).toBe(500);
    expect(computeBackoffDelay(0, 200, 3_000)).toBe(200);
    expect(computeBackoffDelay(4, 200, 3_000)).toBe(3_000);
  });
});

describe('RestartTracker', () => {
  it('allows up to maxRestarts inside the window, then reports over budget', () => {
    const tracker = new RestartTracker(5, 60_000);
    // Restarts 1..5 are within budget.
    for (let i = 1; i <= 5; i++) {
      expect(tracker.record(i * 1_000)).toBe(true);
    }
    // The 6th within the window is over budget → failed.
    expect(tracker.record(6_000)).toBe(false);
    expect(tracker.count).toBe(6);
  });

  it('forgets restarts older than the window', () => {
    const tracker = new RestartTracker(5, 60_000);
    for (let i = 0; i < 5; i++) {
      tracker.record(i * 1_000);
    }
    // Long after the window, old timestamps are pruned so we are back to 1.
    expect(tracker.record(200_000)).toBe(true);
    expect(tracker.count).toBe(1);
  });

  it('resets on demand (stable-running reset)', () => {
    const tracker = new RestartTracker(5, 60_000);
    tracker.record(1_000);
    tracker.record(2_000);
    tracker.reset();
    expect(tracker.count).toBe(0);
    expect(tracker.record(3_000)).toBe(true);
  });
});
