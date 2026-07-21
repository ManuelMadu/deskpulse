import { DeskPulseError } from '@deskpulse/contracts';
import { create } from 'zustand';

import { api } from './api.js';

import type { AgentStatus, ProcessInfo, SystemSummary } from '@deskpulse/contracts';

export interface SurfaceError {
  code: string;
  message: string;
  retryable: boolean;
}

function toSurfaceError(error: unknown): SurfaceError {
  if (error instanceof DeskPulseError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return { code: 'INTERNAL', message: String(error), retryable: false };
}

interface DashboardState {
  agent: AgentStatus | undefined;
  summary: SystemSummary | undefined;
  summaryError: SurfaceError | undefined;
  processes: ProcessInfo[];
  processesError: SurfaceError | undefined;
  sortBy: 'cpu' | 'memory';
  setSortBy: (sortBy: 'cpu' | 'memory') => void;
  /** One polling tick: refresh status, metrics, and processes together. */
  refresh: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  agent: undefined,
  summary: undefined,
  summaryError: undefined,
  processes: [],
  processesError: undefined,
  sortBy: 'cpu',

  setSortBy(sortBy) {
    if (sortBy !== get().sortBy) {
      set({ sortBy });
      void get().refresh();
    }
  },

  async refresh() {
    const [agent, summary, processes] = await Promise.allSettled([
      api.getAgentStatus(),
      api.getSystemSummary(),
      api.getProcesses({ limit: 20, sortBy: get().sortBy }),
    ]);

    set({
      ...(agent.status === 'fulfilled' ? { agent: agent.value } : {}),
      ...(summary.status === 'fulfilled'
        ? { summary: summary.value, summaryError: undefined }
        : { summaryError: toSurfaceError(summary.reason) }),
      ...(processes.status === 'fulfilled'
        ? { processes: processes.value.processes, processesError: undefined }
        : { processesError: toSurfaceError(processes.reason) }),
    });
  },
}));
