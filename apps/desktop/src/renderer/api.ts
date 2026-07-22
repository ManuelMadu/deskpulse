import { DeskPulseError } from '@deskpulse/contracts';

import type {
  AddMonitorInput,
  AgentEvent,
  AgentStatus,
  IpcResult,
  MonitorWithStatus,
  NavigationTarget,
  ProcessQuery,
  ProcessesResponse,
  RecentFile,
  RemoveMonitorInput,
  SelectedFile,
  StartLogWatchInput,
  StopLogWatchInput,
  SystemSummary,
  UpdateMonitorInput,
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
  listMonitors: (): Promise<MonitorWithStatus[]> => unwrap(window.deskPulse.listMonitors()),
  addMonitor: (input: AddMonitorInput): Promise<MonitorWithStatus> =>
    unwrap(window.deskPulse.addMonitor(input)),
  updateMonitor: (input: UpdateMonitorInput): Promise<MonitorWithStatus> =>
    unwrap(window.deskPulse.updateMonitor(input)),
  removeMonitor: (input: RemoveMonitorInput): Promise<void> =>
    unwrap(window.deskPulse.removeMonitor(input)),
  onAgentEvent: (callback: (event: AgentEvent) => void): (() => void) =>
    window.deskPulse.onAgentEvent(callback),
  onNavigate: (callback: (target: NavigationTarget) => void): (() => void) =>
    window.deskPulse.onNavigate(callback),
};
