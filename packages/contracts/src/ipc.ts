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
  systemGetProcesses: 'deskpulse:system:get-processes',
  logsSelectFile: 'deskpulse:logs:select-file',
  logsStartWatch: 'deskpulse:logs:start-watch',
  logsStopWatch: 'deskpulse:logs:stop-watch',
  logsRecentFiles: 'deskpulse:logs:recent-files',
  monitorsList: 'deskpulse:monitors:list',
  monitorsAdd: 'deskpulse:monitors:add',
  monitorsUpdate: 'deskpulse:monitors:update',
  monitorsRemove: 'deskpulse:monitors:remove',
  settingsGet: 'deskpulse:settings:get',
  settingsSetLaunchAtLogin: 'deskpulse:settings:set-launch-at-login',
  /** Single event fan-out channel (agent SSE events, forwarded by Main). */
  event: 'deskpulse:event',
  /** Main→renderer navigation push (e.g. a notification click, PDD §25). */
  navigate: 'deskpulse:navigate',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/**
 * Screens Main can ask the renderer to show (PDD §25 notification click
 * routing). Kept in lockstep with the renderer's Screen union.
 */
export const navigationTargetSchema = z.enum(['dashboard', 'logs', 'monitors']);
export type NavigationTarget = z.infer<typeof navigationTargetSchema>;

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
 * The optional `restart` block drives the crash-recovery banner (PDD §7/§28):
 * "restarting in 4 s… attempt 3/5", and the manual "Restart agent" affordance
 * once `state` is `failed`.
 */
export const agentStatusSchema = z.strictObject({
  state: z.enum(['idle', 'spawning', 'running', 'stopping', 'stopped', 'backoff', 'failed']),
  pid: z.number().int().positive().optional(),
  version: z.string().min(1).optional(),
  restart: z
    .strictObject({
      /** 1-based attempt number of the pending/most-recent restart. */
      attempt: z.number().int().positive(),
      /** Restarts allowed inside the rolling window before `failed`. */
      maxAttempts: z.number().int().positive(),
      /** Epoch ms the next automatic attempt fires (present in `backoff`). */
      nextRetryAtMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export type AgentStatus = z.infer<typeof agentStatusSchema>;
