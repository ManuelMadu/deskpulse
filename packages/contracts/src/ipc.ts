import { z } from 'zod';

import { deskPulseErrorShapeSchema } from './error.js';

import type { DeskPulseErrorShape } from './error.js';

/**
 * IPC surface between renderer and Main (PDD §17). Channels are namespaced
 * `deskpulse:<domain>:<action>`; request/response over ipcRenderer.invoke;
 * events arrive on the single `deskpulse:event` channel.
 */
export const IPC_CHANNELS = {
  agentGetStatus: 'deskpulse:agent:get-status',
  systemGetSummary: 'deskpulse:system:get-summary',
  /** Single event fan-out channel (Phase 4+). */
  event: 'deskpulse:event',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/**
 * Every invoke resolves to this union — never a bare rejection, because
 * Electron flattens rejected promises to plain Error strings and the
 * structured code would be lost. Preload converts `ok: false` back into a
 * thrown DeskPulseError.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: DeskPulseErrorShape };

export function ipcOk<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function ipcErr(error: DeskPulseErrorShape): IpcResult<never> {
  return { ok: false, error };
}

/** Runtime schema for the failure arm (preload validates before rethrowing). */
export const ipcFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: deskPulseErrorShapeSchema,
});

/**
 * Supervisor status as shown to the renderer. Never contains the token or
 * the agent port — the renderer has no business dialing the agent (PDD §14).
 */
export const agentStatusSchema = z.strictObject({
  state: z.enum(['idle', 'spawning', 'running', 'stopping', 'stopped', 'backoff', 'failed']),
  pid: z.number().int().positive().optional(),
  version: z.string().min(1).optional(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;
