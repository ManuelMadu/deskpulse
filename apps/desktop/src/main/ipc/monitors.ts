import {
  addMonitorInputSchema,
  monitorWithStatusSchema,
  removeMonitorInputSchema,
  updateMonitorInputSchema,
} from '@deskpulse/contracts';
import { z } from 'zod';

import type { AgentConfigStore } from '../agent-config-store.js';
import type { AgentClient } from '../agent-client.js';
import type {
  AddMonitorInput,
  MonitorWithStatus,
  RemoveMonitorInput,
  UpdateMonitorInput,
} from '@deskpulse/contracts';

const monitorListSchema = z.array(monitorWithStatusSchema);

/**
 * Monitor IPC handlers — thin proxies to the agent's CRUD endpoints (PDD §16).
 * Successful writes are mirrored into the config store so the supervisor can
 * re-push them to a restarted agent (PDD §28).
 */
export function handleListMonitors(client: AgentClient): () => Promise<MonitorWithStatus[]> {
  return () => client.get('/monitors', monitorListSchema);
}

export function handleAddMonitor(
  client: AgentClient,
  store: AgentConfigStore,
): (input: AddMonitorInput) => Promise<MonitorWithStatus> {
  return async (input) => {
    const created = await client.post('/monitors', input, monitorWithStatusSchema);
    store.recordMonitor(created.id, input);
    return created;
  };
}

export function handleUpdateMonitor(
  client: AgentClient,
  store: AgentConfigStore,
): (input: UpdateMonitorInput) => Promise<MonitorWithStatus> {
  return async (input) => {
    const updated = await client.patch(
      `/monitors/${input.id}`,
      input.patch,
      monitorWithStatusSchema,
    );
    store.mergeMonitor(input.id, input.patch);
    return updated;
  };
}

export function handleRemoveMonitor(
  client: AgentClient,
  store: AgentConfigStore,
): (input: RemoveMonitorInput) => Promise<void> {
  return async (input) => {
    await client.delete(`/monitors/${input.id}`);
    store.removeMonitor(input.id);
  };
}

export const monitorsInputSchemas = {
  add: addMonitorInputSchema,
  update: updateMonitorInputSchema,
  remove: removeMonitorInputSchema,
};
