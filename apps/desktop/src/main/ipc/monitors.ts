import {
  addMonitorInputSchema,
  monitorWithStatusSchema,
  removeMonitorInputSchema,
  updateMonitorInputSchema,
} from '@deskpulse/contracts';
import { z } from 'zod';

import type { AgentClient } from '../agent-client.js';
import type {
  AddMonitorInput,
  MonitorWithStatus,
  RemoveMonitorInput,
  UpdateMonitorInput,
} from '@deskpulse/contracts';

const monitorListSchema = z.array(monitorWithStatusSchema);

/** Monitor IPC handlers — thin proxies to the agent's CRUD endpoints (PDD §16). */
export function handleListMonitors(client: AgentClient): () => Promise<MonitorWithStatus[]> {
  return () => client.get('/monitors', monitorListSchema);
}

export function handleAddMonitor(
  client: AgentClient,
): (input: AddMonitorInput) => Promise<MonitorWithStatus> {
  return (input) => client.post('/monitors', input, monitorWithStatusSchema);
}

export function handleUpdateMonitor(
  client: AgentClient,
): (input: UpdateMonitorInput) => Promise<MonitorWithStatus> {
  return (input) => client.patch(`/monitors/${input.id}`, input.patch, monitorWithStatusSchema);
}

export function handleRemoveMonitor(
  client: AgentClient,
): (input: RemoveMonitorInput) => Promise<void> {
  return (input) => client.delete(`/monitors/${input.id}`);
}

export const monitorsInputSchemas = {
  add: addMonitorInputSchema,
  update: updateMonitorInputSchema,
  remove: removeMonitorInputSchema,
};
