import { monitorWithStatusSchema, watchCreatedSchema } from '@deskpulse/contracts';

import type { AgentConfigStore } from './agent-config-store.js';
import type { AgentClient } from './agent-client.js';
import type { ReconcilePayload } from '@deskpulse/contracts';

type Logger = (level: 'info' | 'warn', msg: string, ctx?: Record<string, unknown>) => void;

export interface ReconcileDeps {
  client: AgentClient;
  store: AgentConfigStore;
  log?: Logger;
}

/**
 * Re-push Main's config to a freshly restarted agent (PDD §28). The new agent
 * is empty and hands out new ids, so every monitor and watch is recreated and
 * the store is re-keyed. Returns the old→new watch id remap so the renderer can
 * keep its open log views streaming. Individual failures are logged and skipped
 * — a best-effort resume beats aborting the whole reconciliation.
 */
export async function reconcileAgentConfig(deps: ReconcileDeps): Promise<ReconcilePayload> {
  const { client, store, log } = deps;

  const monitors = store.monitorEntries();
  store.resetMonitors();
  for (const [oldId, config] of monitors) {
    try {
      const created = await client.post('/monitors', config, monitorWithStatusSchema);
      store.recordMonitor(created.id, config);
    } catch (error) {
      log?.('warn', 'failed to re-push monitor after restart', { oldId, cause: String(error) });
    }
  }

  const watchRemap: Record<string, string> = {};
  const watches = store.watchEntries();
  store.resetWatches();
  for (const [oldId, spec] of watches) {
    try {
      const created = await client.post('/watch', spec, watchCreatedSchema);
      store.recordWatch(created.id, spec);
      watchRemap[oldId] = created.id;
    } catch (error) {
      log?.('warn', 'failed to re-issue watch after restart', { oldId, cause: String(error) });
    }
  }

  return { watchRemap };
}
