import { describe, expect, it } from 'vitest';

import { MAX_MONITOR_ROWS, buildTrayView } from './tray-model.js';

import type { HealthSnapshot, MonitorLine } from './health-state.js';

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    health: 'nominal',
    agentUp: true,
    monitors: [],
    unhealthyCount: 0,
    erroredWatchCount: 0,
    ...overrides,
  };
}

function monitor(name: string, state: MonitorLine['state']): MonitorLine {
  return { id: `id-${name}`, name, state };
}

describe('buildTrayView', () => {
  it('reports all-nominal when the agent is up and nothing is configured', () => {
    const view = buildTrayView(snapshot());
    expect(view.icon).toBe('nominal');
    expect(view.statusLine).toBe('All systems nominal');
    expect(view.tooltip).toBe('DeskPulse — All systems nominal');
    expect(view.monitorRows).toEqual([]);
    expect(view.overflowCount).toBe(0);
  });

  it('reports all-healthy when monitors exist and none are unhealthy', () => {
    const view = buildTrayView(
      snapshot({ monitors: [monitor('api', 'healthy'), monitor('db', 'healthy')] }),
    );
    expect(view.statusLine).toBe('All monitors healthy');
    expect(view.monitorRows).toEqual([
      { label: 'api — Healthy', state: 'healthy' },
      { label: 'db — Healthy', state: 'healthy' },
    ]);
  });

  it('summarises unhealthy monitors and errored watches, with pluralisation', () => {
    expect(buildTrayView(snapshot({ health: 'degraded', unhealthyCount: 1 })).statusLine).toBe(
      '1 monitor unhealthy',
    );
    expect(
      buildTrayView(snapshot({ health: 'degraded', unhealthyCount: 2, erroredWatchCount: 1 }))
        .statusLine,
    ).toBe('2 monitors unhealthy, 1 log in error');
  });

  it('shows the agent-down state when the agent is not running', () => {
    const view = buildTrayView(snapshot({ health: 'agent-down', agentUp: false }));
    expect(view.icon).toBe('agent-down');
    expect(view.statusLine).toBe('Agent not running');
  });

  it('caps the monitor list and reports the overflow count', () => {
    const monitors = Array.from({ length: MAX_MONITOR_ROWS + 2 }, (_, i) =>
      monitor(`m${i}`, 'healthy'),
    );
    const view = buildTrayView(snapshot({ monitors }));
    expect(view.monitorRows).toHaveLength(MAX_MONITOR_ROWS);
    expect(view.overflowCount).toBe(2);
  });
});
