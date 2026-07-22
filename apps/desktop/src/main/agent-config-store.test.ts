import { describe, expect, it } from 'vitest';

import { AgentConfigStore } from './agent-config-store.js';

import type { MonitorConfigInput } from '@deskpulse/contracts';

const CONFIG: MonitorConfigInput = {
  name: 'api',
  url: 'http://127.0.0.1:8080/health',
  method: 'GET',
  intervalSeconds: 30,
  timeoutMs: 5000,
  expectedStatus: { min: 200, max: 399 },
  failureThreshold: 3,
  recoveryThreshold: 1,
  enabled: true,
};

describe('AgentConfigStore', () => {
  it('records and removes monitors and watches', () => {
    const store = new AgentConfigStore();
    store.recordMonitor('m1', CONFIG);
    store.recordWatch('w1', { path: '/var/log/a.log', fromEnd: true, encoding: 'utf8' });
    expect(store.monitorEntries()).toHaveLength(1);
    expect(store.watchEntries()).toHaveLength(1);

    store.removeMonitor('m1');
    store.removeWatch('w1');
    expect(store.monitorEntries()).toEqual([]);
    expect(store.watchEntries()).toEqual([]);
  });

  it('merges only the defined fields of a patch', () => {
    const store = new AgentConfigStore();
    store.recordMonitor('m1', CONFIG);
    store.mergeMonitor('m1', { enabled: false, intervalSeconds: 60 });

    const [, merged] = store.monitorEntries()[0]!;
    expect(merged).toEqual({ ...CONFIG, enabled: false, intervalSeconds: 60 });
  });

  it('ignores a merge for an unknown monitor', () => {
    const store = new AgentConfigStore();
    store.mergeMonitor('ghost', { enabled: false });
    expect(store.monitorEntries()).toEqual([]);
  });

  it('resets each collection independently', () => {
    const store = new AgentConfigStore();
    store.recordMonitor('m1', CONFIG);
    store.recordWatch('w1', { path: '/a', fromEnd: false, encoding: 'utf8' });
    store.resetMonitors();
    expect(store.monitorEntries()).toEqual([]);
    expect(store.watchEntries()).toHaveLength(1);
  });
});
