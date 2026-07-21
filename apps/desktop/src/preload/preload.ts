import {
  IPC_CHANNELS,
  agentStatusSchema,
  ipcFailureSchema,
  processQuerySchema,
  processesResponseSchema,
  systemSummarySchema,
} from '@deskpulse/contracts';
import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgentStatus,
  IpcResult,
  ProcessQuery,
  ProcessesResponse,
  SystemSummary,
} from '@deskpulse/contracts';
import type { ZodType } from 'zod';

/**
 * The ONLY bridge between renderer and Main (PDD §17). Never exposes
 * ipcRenderer, never exposes Node — a frozen object of narrow, typed
 * operations.
 *
 * Results cross the bridge as plain IpcResult data, validated here in the
 * preload: a thrown Error would be stripped to its message by the
 * contextBridge, losing the structured `code` the UI switches on. The
 * renderer's api wrapper converts failures into DeskPulseError.
 */

async function invoke<T>(
  channel: string,
  schema: ZodType<T>,
  args?: unknown,
): Promise<IpcResult<T>> {
  const raw: unknown =
    args === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, args);
  const failure = ipcFailureSchema.safeParse(raw);
  if (failure.success) {
    return failure.data;
  }
  const success =
    typeof raw === 'object' && raw !== null && (raw as { ok?: unknown }).ok === true
      ? schema.safeParse((raw as { data?: unknown }).data)
      : undefined;
  if (success?.success) {
    return { ok: true, data: success.data };
  }
  return {
    ok: false,
    error: {
      code: 'MALFORMED_RESPONSE',
      message: 'Main returned an unrecognized IPC result.',
      retryable: false,
    },
  };
}

export interface DeskPulseTransport {
  getAgentStatus(): Promise<IpcResult<AgentStatus>>;
  getSystemSummary(): Promise<IpcResult<SystemSummary>>;
  getProcesses(query: ProcessQuery): Promise<IpcResult<ProcessesResponse>>;
}

const transport: DeskPulseTransport = {
  getAgentStatus: () => invoke(IPC_CHANNELS.agentGetStatus, agentStatusSchema),
  getSystemSummary: () => invoke(IPC_CHANNELS.systemGetSummary, systemSummarySchema),
  getProcesses: (query) => {
    // Cheap sanity parse — defense in depth, not the boundary; Main
    // re-validates authoritatively (PDD §17).
    const parsed = processQuerySchema.safeParse(query);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false as const,
        error: {
          code: 'VALIDATION_FAILED' as const,
          message: 'Invalid process query.',
          retryable: false,
        },
      });
    }
    return invoke(IPC_CHANNELS.systemGetProcesses, processesResponseSchema, parsed.data);
  },
};

contextBridge.exposeInMainWorld('deskPulse', Object.freeze(transport));
