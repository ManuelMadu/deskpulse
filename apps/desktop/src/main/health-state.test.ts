import { describe, expect, it } from 'vitest';

import { HealthState } from './health-state.js';

import type { AgentEvent, MonitorWithStatus } from '@deskpulse/contracts';

const AT = '2026-07-22T00:00:00.000Z';
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const WATCH = '33333333-3333-4333-8333-333333333333';

const agentReady: AgentEvent = {
  type: 'agent.status',
  status: 'ready',
  pid: 4242,
  version: '0.1.0',
  runId: 'run-abcdef01',
};

function unhealthy(id: string, name: string): AgentEvent {
  return { type: 'monitor.unhealthy', monitorId: id, name, at: AT, consecutiveFailures: 3 };
}

function recovered(id: string, name: string): AgentEvent {
  return { type: 'monitor.recovered', monitorId: id, name, at: AT, downtimeSeconds: 12 };
}

function withStatus(
  id: string,
  name: string,
  state: MonitorWithStatus['state'],
): MonitorWithStatus {
  return {
    id,
    name,
    url: 'http://127.0.0.1:8080/health',
    method: 'GET',
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatus: { min: 200, max: 399 },
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: true,
    state,
    consecutiveFailures: state === 'unhealthy' ? 3 : 0,
    recentResults: [],
  };
}

describe('HealthState', () => {
  it('starts agent-down until the agent reports ready', () => {
    const state = new HealthState();
    expect(state.snapshot().health).toBe('agent-down');
    expect(state.ingest(agentReady)).toBe(true);
    expect(state.snapshot().health).toBe('nominal');
    // A second ready is a no-op for the snapshot.
    expect(state.ingest(agentReady)).toBe(false);
  });

  it('goes degraded on an unhealthy transition and back to nominal on recovery', () => {
    const state = new HealthState();
    state.ingest(agentReady);
    expect(state.ingest(unhealthy(ID_A, 'api'))).toBe(true);
    let snap = state.snapshot();
    expect(snap.health).toBe('degraded');
    expect(snap.unhealthyCount).toBe(1);
    expect(snap.monitors[0]).toMatchObject({ id: ID_A, name: 'api', state: 'unhealthy' });

    expect(state.ingest(recovered(ID_A, 'api'))).toBe(true);
    snap = state.snapshot();
    expect(snap.health).toBe('nominal');
    expect(snap.unhealthyCount).toBe(0);
  });

  it('treats an errored watch as degraded until lines flow again', () => {
    const state = new HealthState();
    state.ingest(agentReady);
    const errorEvent: AgentEvent = {
      type: 'log.error',
      watchId: WATCH,
      error: { code: 'INTERNAL', message: 'EACCES', retryable: false },
    };
    expect(state.ingest(errorEvent)).toBe(true);
    expect(state.snapshot().health).toBe('degraded');
    expect(state.snapshot().erroredWatchCount).toBe(1);

    const entryEvent: AgentEvent = {
      type: 'log.entry',
      watchId: WATCH,
      entries: [{ line: 'ok', offset: 3, at: AT }],
      dropped: 0,
      truncatedLines: 0,
    };
    expect(state.ingest(entryEvent)).toBe(true);
    expect(state.snapshot().health).toBe('nominal');
  });

  it('agent-down outranks monitor health', () => {
    const state = new HealthState();
    state.ingest(agentReady);
    state.ingest(unhealthy(ID_A, 'api'));
    expect(state.setAgentUp(false)).toBe(true);
    expect(state.snapshot().health).toBe('agent-down');
  });

  it('ignores monitor.result frames (no snapshot change)', () => {
    const state = new HealthState();
    state.ingest(agentReady);
    const result: AgentEvent = { type: 'monitor.result', monitorId: ID_A, at: AT, ok: true };
    expect(state.ingest(result)).toBe(false);
  });

  it('hydrates from a snapshot, sorting unhealthy first', () => {
    const state = new HealthState();
    state.setAgentUp(true);
    const changed = state.hydrateMonitors([
      withStatus(ID_A, 'zeta', 'healthy'),
      withStatus(ID_B, 'alpha', 'unhealthy'),
    ]);
    expect(changed).toBe(true);
    const snap = state.snapshot();
    expect(snap.monitors.map((m) => m.name)).toEqual(['alpha', 'zeta']);
    expect(snap.health).toBe('degraded');
  });

  it('reconciles removed monitors on rehydrate', () => {
    const state = new HealthState();
    state.setAgentUp(true);
    state.hydrateMonitors([withStatus(ID_A, 'api', 'unhealthy')]);
    expect(state.snapshot().unhealthyCount).toBe(1);
    state.hydrateMonitors([]);
    expect(state.snapshot().monitors).toEqual([]);
    expect(state.snapshot().health).toBe('nominal');
  });
});
