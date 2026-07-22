import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationPolicy } from './notification-policy.js';

import type { MonitorTransition, NotificationRequest } from './notification-policy.js';

function transition(kind: MonitorTransition['kind'], name: string): MonitorTransition {
  return { kind, monitorId: `id-${name}`, name };
}

describe('NotificationPolicy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits a single notification per transition below the coalesce threshold', () => {
    const emitted: NotificationRequest[] = [];
    const policy = new NotificationPolicy({ emit: (r) => emitted.push(r) });

    policy.record(transition('unhealthy', 'api'));
    policy.record(transition('recovered', 'db'));
    // Nothing fires until the window closes.
    expect(emitted).toEqual([]);

    vi.advanceTimersByTime(5_000);
    expect(emitted).toEqual([
      { kind: 'single', transition: transition('unhealthy', 'api') },
      { kind: 'single', transition: transition('recovered', 'db') },
    ]);
  });

  it('coalesces a burst of more than three transitions into one summary', () => {
    const emitted: NotificationRequest[] = [];
    const policy = new NotificationPolicy({ emit: (r) => emitted.push(r) });

    policy.record(transition('unhealthy', 'a'));
    policy.record(transition('unhealthy', 'b'));
    policy.record(transition('unhealthy', 'c'));
    policy.record(transition('recovered', 'd'));

    vi.advanceTimersByTime(5_000);
    expect(emitted).toEqual([{ kind: 'summary', unhealthy: 3, recovered: 1, total: 4 }]);
  });

  it('starts a fresh window after a flush', () => {
    const emitted: NotificationRequest[] = [];
    const policy = new NotificationPolicy({ emit: (r) => emitted.push(r) });

    policy.record(transition('unhealthy', 'api'));
    vi.advanceTimersByTime(5_000);
    policy.record(transition('recovered', 'api'));
    vi.advanceTimersByTime(5_000);

    expect(emitted).toEqual([
      { kind: 'single', transition: transition('unhealthy', 'api') },
      { kind: 'single', transition: transition('recovered', 'api') },
    ]);
  });

  it('respects an injected window and threshold', () => {
    const emitted: NotificationRequest[] = [];
    const policy = new NotificationPolicy({
      emit: (r) => emitted.push(r),
      coalesceWindowMs: 1_000,
      coalesceThreshold: 1,
    });

    policy.record(transition('unhealthy', 'a'));
    policy.record(transition('unhealthy', 'b'));
    vi.advanceTimersByTime(1_000);
    expect(emitted).toEqual([{ kind: 'summary', unhealthy: 2, recovered: 0, total: 2 }]);
  });

  it('drops a pending window on dispose', () => {
    const emitted: NotificationRequest[] = [];
    const policy = new NotificationPolicy({ emit: (r) => emitted.push(r) });

    policy.record(transition('unhealthy', 'api'));
    policy.dispose();
    vi.advanceTimersByTime(10_000);
    expect(emitted).toEqual([]);
  });
});
