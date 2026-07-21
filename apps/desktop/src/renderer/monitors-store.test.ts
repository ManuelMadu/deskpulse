import { beforeEach, describe, expect, it } from 'vitest';

import { useMonitorsStore } from './monitors-store.js';

import type { AgentEvent, MonitorWithStatus } from '@deskpulse/contracts';

const ID = '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71';

function monitor(overrides: Partial<MonitorWithStatus> = {}): MonitorWithStatus {
  return {
    id: ID,
    name: 'API',
    url: 'http://127.0.0.1:3000/healthz',
    method: 'GET',
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatus: { min: 200, max: 399 },
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: true,
    state: 'unknown',
    consecutiveFailures: 0,
    recentResults: [],
    ...overrides,
  };
}

function seed(m: MonitorWithStatus): void {
  useMonitorsStore.setState({ monitors: [m], error: undefined, loaded: true });
}

describe('monitors store ingestion', () => {
  beforeEach(() => useMonitorsStore.setState({ monitors: [], error: undefined, loaded: false }));

  it('records a probe result and promotes unknown → healthy on the first ok', () => {
    seed(monitor());
    const event: AgentEvent = {
      type: 'monitor.result',
      monitorId: ID,
      at: '2026-07-21T10:15:02.100Z',
      ok: true,
      statusCode: 200,
      latencyMs: 12,
    };
    useMonitorsStore.getState().ingest(event);
    const m = useMonitorsStore.getState().monitors[0]!;
    expect(m.state).toBe('healthy');
    expect(m.lastResult?.latencyMs).toBe(12);
    expect(m.recentResults).toHaveLength(1);
  });

  it('applies unhealthy and recovered transitions', () => {
    seed(monitor({ state: 'healthy' }));
    useMonitorsStore.getState().ingest({
      type: 'monitor.unhealthy',
      monitorId: ID,
      name: 'API',
      at: '2026-07-21T10:15:02.100Z',
      consecutiveFailures: 3,
    });
    expect(useMonitorsStore.getState().monitors[0]!.state).toBe('unhealthy');

    useMonitorsStore.getState().ingest({
      type: 'monitor.recovered',
      monitorId: ID,
      name: 'API',
      at: '2026-07-21T10:15:05.100Z',
      downtimeSeconds: 3,
    });
    expect(useMonitorsStore.getState().monitors[0]!.state).toBe('healthy');
  });

  it('caps the sparkline history at 20 results', () => {
    seed(monitor());
    for (let i = 0; i < 25; i += 1) {
      useMonitorsStore.getState().ingest({
        type: 'monitor.result',
        monitorId: ID,
        at: '2026-07-21T10:15:02.100Z',
        ok: i % 2 === 0,
      });
    }
    expect(useMonitorsStore.getState().monitors[0]!.recentResults).toHaveLength(20);
  });

  it('ignores events for unknown monitors and non-monitor events', () => {
    seed(monitor());
    expect(() =>
      useMonitorsStore.getState().ingest({
        type: 'monitor.result',
        monitorId: '018f0000-0000-7000-8000-000000000000',
        at: '2026-07-21T10:15:02.100Z',
        ok: false,
      }),
    ).not.toThrow();
    useMonitorsStore.getState().ingest({ type: 'agent.warning', code: 'x', message: 'irrelevant' });
    expect(useMonitorsStore.getState().monitors[0]!.state).toBe('unknown');
  });
});
