import {
  IPC_CHANNELS,
  agentEventSchema,
  agentStatusSchema,
  appSettingsSchema,
  ipcFailureSchema,
  monitorWithStatusSchema,
  navigationTargetSchema,
  processQuerySchema,
  processesResponseSchema,
  recentFileSchema,
  selectedFileSchema,
  systemSummarySchema,
  watchHandleSchema,
} from '@deskpulse/contracts';
import { contextBridge, ipcRenderer } from 'electron';
import { z } from 'zod';

import type {
  AddMonitorInput,
  AgentEvent,
  AgentStatus,
  AppSettings,
  IpcResult,
  MonitorWithStatus,
  NavigationTarget,
  ProcessQuery,
  ProcessesResponse,
  RecentFile,
  RemoveMonitorInput,
  SelectedFile,
  SetLaunchAtLoginInput,
  StartLogWatchInput,
  StopLogWatchInput,
  SystemSummary,
  UpdateMonitorInput,
  WatchHandle,
} from '@deskpulse/contracts';
import type { IpcRendererEvent } from 'electron';
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

const selectedFileOrNull = z.union([selectedFileSchema, z.null()]);

export interface DeskPulseTransport {
  getAgentStatus(): Promise<IpcResult<AgentStatus>>;
  getSystemSummary(): Promise<IpcResult<SystemSummary>>;
  getProcesses(query: ProcessQuery): Promise<IpcResult<ProcessesResponse>>;
  selectLogFile(): Promise<IpcResult<SelectedFile | null>>;
  getRecentLogFiles(): Promise<IpcResult<RecentFile[]>>;
  startLogWatch(input: StartLogWatchInput): Promise<IpcResult<WatchHandle>>;
  stopLogWatch(input: StopLogWatchInput): Promise<IpcResult<void>>;
  listMonitors(): Promise<IpcResult<MonitorWithStatus[]>>;
  addMonitor(input: AddMonitorInput): Promise<IpcResult<MonitorWithStatus>>;
  updateMonitor(input: UpdateMonitorInput): Promise<IpcResult<MonitorWithStatus>>;
  removeMonitor(input: RemoveMonitorInput): Promise<IpcResult<void>>;
  getSettings(): Promise<IpcResult<AppSettings>>;
  setLaunchAtLogin(input: SetLaunchAtLoginInput): Promise<IpcResult<AppSettings>>;
  /** Subscribe to forwarded agent events; returns an unsubscribe function. */
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
  /** Subscribe to Main-initiated screen navigation (e.g. notification click). */
  onNavigate(callback: (target: NavigationTarget) => void): () => void;
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
  selectLogFile: () => invoke(IPC_CHANNELS.logsSelectFile, selectedFileOrNull),
  getRecentLogFiles: () => invoke(IPC_CHANNELS.logsRecentFiles, z.array(recentFileSchema)),
  startLogWatch: (input) => invoke(IPC_CHANNELS.logsStartWatch, watchHandleSchema, input),
  stopLogWatch: (input) => invoke(IPC_CHANNELS.logsStopWatch, z.void(), input),
  listMonitors: () => invoke(IPC_CHANNELS.monitorsList, z.array(monitorWithStatusSchema)),
  addMonitor: (input) => invoke(IPC_CHANNELS.monitorsAdd, monitorWithStatusSchema, input),
  updateMonitor: (input) => invoke(IPC_CHANNELS.monitorsUpdate, monitorWithStatusSchema, input),
  removeMonitor: (input) => invoke(IPC_CHANNELS.monitorsRemove, z.void(), input),
  getSettings: () => invoke(IPC_CHANNELS.settingsGet, appSettingsSchema),
  setLaunchAtLogin: (input) =>
    invoke(IPC_CHANNELS.settingsSetLaunchAtLogin, appSettingsSchema, input),

  onAgentEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      // Validate in the preload too: the renderer only ever sees well-formed
      // events, even though Main already parsed them.
      const parsed = agentEventSchema.safeParse(payload);
      if (parsed.success) {
        callback(parsed.data);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, listener);
  },

  onNavigate: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      const parsed = navigationTargetSchema.safeParse(payload);
      if (parsed.success) {
        callback(parsed.data);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.navigate, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.navigate, listener);
  },
};

contextBridge.exposeInMainWorld('deskPulse', Object.freeze(transport));
