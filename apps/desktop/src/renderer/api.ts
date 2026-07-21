import { DeskPulseError } from '@deskpulse/contracts';

import type {
  AgentEvent,
  AgentStatus,
  IpcResult,
  ProcessQuery,
  ProcessesResponse,
  RecentFile,
  SelectedFile,
  StartLogWatchInput,
  StopLogWatchInput,
  SystemSummary,
  WatchHandle,
} from '@deskpulse/contracts';

/**
 * Renderer-facing API (PDD §17 shape): unwraps the preload transport's
 * IpcResult into resolved data or a thrown DeskPulseError. The class can't
 * cross the contextBridge intact, so the conversion happens on this side.
 */
async function unwrap<T>(result: Promise<IpcResult<T>>): Promise<T> {
  const resolved = await result;
  if (resolved.ok) {
    return resolved.data;
  }
  throw new DeskPulseError(resolved.error);
}

export const api = {
  getAgentStatus: (): Promise<AgentStatus> => unwrap(window.deskPulse.getAgentStatus()),
  getSystemSummary: (): Promise<SystemSummary> => unwrap(window.deskPulse.getSystemSummary()),
  getProcesses: (query: ProcessQuery): Promise<ProcessesResponse> =>
    unwrap(window.deskPulse.getProcesses(query)),
  selectLogFile: (): Promise<SelectedFile | null> => unwrap(window.deskPulse.selectLogFile()),
  getRecentLogFiles: (): Promise<RecentFile[]> => unwrap(window.deskPulse.getRecentLogFiles()),
  startLogWatch: (input: StartLogWatchInput): Promise<WatchHandle> =>
    unwrap(window.deskPulse.startLogWatch(input)),
  stopLogWatch: (input: StopLogWatchInput): Promise<void> =>
    unwrap(window.deskPulse.stopLogWatch(input)),
  onAgentEvent: (callback: (event: AgentEvent) => void): (() => void) =>
    window.deskPulse.onAgentEvent(callback),
};
