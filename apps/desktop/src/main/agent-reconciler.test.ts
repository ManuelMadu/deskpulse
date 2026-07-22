import { describe, expect, it, vi } from 'vitest';

import { AgentConfigStore } from './agent-config-store.js';
import { reconcileAgentConfig } from './agent-reconciler.js';

import type { AgentClient } from './agent-client.js';
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

const WATCH = { path: '/var/log/app.log', fromEnd: true, encoding: 'utf8' as const };

/** A fake AgentClient whose POSTs hand out fresh ids, like a restarted agent. */
function fakeClient(): { client: AgentClient; posts: { path: string; body: unknown }[] } {
  const posts: { path: string; body: unknown }[] = [];
  let seq = 0;
  const client = {
    post: vi.fn((path: string, body: unknown) => {
      posts.push({ path, body });
      seq += 1;
      const id = `00000000-0000-4000-8000-00000000000${seq}`;
      return Promise.resolve(
        path === '/monitors' ? { id } : { id, path: WATCH.path, startOffset: 0, fileSizeBytes: 0 },
      );
    }),
  } as unknown as AgentClient;
  return { client, posts };
}

describe('reconcileAgentConfig', () => {
  it('re-pushes monitors and re-issues watches, remapping watch ids', async () => {
    const store = new AgentConfigStore();
    store.recordMonitor('old-monitor', CONFIG);
    store.recordWatch('old-watch', WATCH);
    const { client, posts } = fakeClient();

    const payload = await reconcileAgentConfig({ store, client });

    // Both a monitor and a watch were re-created on the fresh agent.
    expect(posts.map((p) => p.path)).toEqual(['/monitors', '/watch']);
    // The store is re-keyed under the new ids; the old ones are gone.
    expect(store.monitorEntries().map(([id]) => id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ]);
    expect(store.watchEntries().map(([id]) => id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
    ]);
    // The renderer gets old→new so it can re-key its open log view.
    expect(payload.watchRemap).toEqual({
      'old-watch': '00000000-0000-4000-8000-000000000002',
    });
  });

  it('skips a failed re-push and still reconciles the rest', async () => {
    const store = new AgentConfigStore();
    store.recordWatch('w1', WATCH);
    store.recordWatch('w2', WATCH);
    let calls = 0;
    const client = {
      post: vi.fn(() => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('agent not ready'));
        }
        return Promise.resolve({
          id: 'aaaaaaaa-0000-4000-8000-000000000000',
          path: WATCH.path,
          startOffset: 0,
          fileSizeBytes: 0,
        });
      }),
    } as unknown as AgentClient;

    const payload = await reconcileAgentConfig({ store, client });

    // One watch failed, the other resumed — best effort, not all-or-nothing.
    expect(Object.keys(payload.watchRemap)).toHaveLength(1);
    expect(store.watchEntries()).toHaveLength(1);
  });
});
