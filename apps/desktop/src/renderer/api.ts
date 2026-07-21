import { DeskPulseError } from '@deskpulse/contracts';

import type {
  AgentStatus,
  IpcResult,
  ProcessQuery,
  ProcessesResponse,
  SystemSummary,
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
};
