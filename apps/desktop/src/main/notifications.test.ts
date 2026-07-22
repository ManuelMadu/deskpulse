import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MonitorNotifier, messageFor } from './notifications.js';

import type { Presentation } from './notifications.js';
import type { AgentEvent } from '@deskpulse/contracts';

const AT = '2026-07-22T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

function unhealthy(name: string): AgentEvent {
  return { type: 'monitor.unhealthy', monitorId: ID, name, at: AT, consecutiveFailures: 3 };
}
function recovered(name: string): AgentEvent {
  return { type: 'monitor.recovered', monitorId: ID, name, at: AT, downtimeSeconds: 5 };
}

interface Shown {
  title: string;
  body: string;
  clickHandlers: (() => void)[];
}

function fakePresenter(shown: Shown[]) {
  return (payload: { title: string; body: string }): Presentation => {
    const entry: Shown = { ...payload, clickHandlers: [] };
    shown.push(entry);
    return { onClick: (handler) => entry.clickHandlers.push(handler) };
  };
}

describe('messageFor', () => {
  it('phrases single transitions', () => {
    expect(
      messageFor({ kind: 'single', transition: { kind: 'unhealthy', monitorId: ID, name: 'api' } }),
    ).toEqual({
      title: 'Monitor unhealthy',
      body: 'api stopped responding.',
    });
    expect(
      messageFor({ kind: 'single', transition: { kind: 'recovered', monitorId: ID, name: 'api' } }),
    ).toEqual({
      title: 'Monitor recovered',
      body: 'api is healthy again.',
    });
  });

  it('phrases mixed and one-sided summaries', () => {
    expect(messageFor({ kind: 'summary', unhealthy: 4, recovered: 0, total: 4 }).body).toBe(
      '4 monitors went unhealthy.',
    );
    expect(messageFor({ kind: 'summary', unhealthy: 0, recovered: 4, total: 4 }).body).toBe(
      '4 monitors recovered.',
    );
    expect(messageFor({ kind: 'summary', unhealthy: 2, recovered: 2, total: 4 }).body).toBe(
      '2 unhealthy, 2 recovered.',
    );
  });
});

describe('MonitorNotifier', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('notifies on a monitor transition and routes a click to the Monitors screen', () => {
    const shown: Shown[] = [];
    const onActivate = vi.fn();
    const notifier = new MonitorNotifier({ present: fakePresenter(shown), onActivate });

    notifier.handleEvent(unhealthy('api'));
    vi.advanceTimersByTime(5_000);

    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Monitor unhealthy', body: 'api stopped responding.' });

    shown[0]!.clickHandlers.forEach((handler) => handler());
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('ignores non-transition events (results, logs, status)', () => {
    const shown: Shown[] = [];
    const notifier = new MonitorNotifier({ present: fakePresenter(shown), onActivate: vi.fn() });

    notifier.handleEvent({ type: 'monitor.result', monitorId: ID, at: AT, ok: false });
    vi.advanceTimersByTime(5_000);
    expect(shown).toEqual([]);
  });

  it('coalesces a burst into a single summary banner', () => {
    const shown: Shown[] = [];
    const notifier = new MonitorNotifier({ present: fakePresenter(shown), onActivate: vi.fn() });

    for (const name of ['a', 'b', 'c', 'd']) {
      notifier.handleEvent(unhealthy(name));
    }
    notifier.handleEvent(recovered('e'));
    vi.advanceTimersByTime(5_000);

    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('5 monitors changed state');
  });
});
