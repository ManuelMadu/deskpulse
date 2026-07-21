import { DeskPulseError } from '@deskpulse/contracts';
import { create } from 'zustand';

import { api } from './api.js';

import type {
  AddMonitorInput,
  AgentEvent,
  MonitorPatch,
  MonitorWithStatus,
  ProbeResult,
} from '@deskpulse/contracts';

const SPARK_HISTORY = 20; // last-20 pass/fail ticks shown per monitor

function toSurfaceError(error: unknown): string {
  return error instanceof DeskPulseError ? error.message : String(error);
}

interface MonitorsState {
  monitors: MonitorWithStatus[];
  error: string | undefined;
  loaded: boolean;
  refresh: () => Promise<void>;
  add: (input: AddMonitorInput) => Promise<void>;
  update: (id: string, patch: MonitorPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  ingest: (event: AgentEvent) => void;
}

export const useMonitorsStore = create<MonitorsState>((set, get) => ({
  monitors: [],
  error: undefined,
  loaded: false,

  async refresh() {
    try {
      set({ monitors: await api.listMonitors(), error: undefined, loaded: true });
    } catch (error) {
      set({ error: toSurfaceError(error), loaded: true });
    }
  },

  async add(input) {
    // The agent is the source of truth; refetch so runtime state is exact.
    await api.addMonitor(input);
    await get().refresh();
  },

  async update(id, patch) {
    await api.updateMonitor({ id, patch });
    await get().refresh();
  },

  async remove(id) {
    await api.removeMonitor({ id });
    await get().refresh();
  },

  ingest(event) {
    if (
      event.type !== 'monitor.result' &&
      event.type !== 'monitor.unhealthy' &&
      event.type !== 'monitor.recovered'
    ) {
      return;
    }
    set((state) => ({
      monitors: state.monitors.map((monitor) => {
        if (monitor.id !== event.monitorId) {
          return monitor;
        }
        if (event.type === 'monitor.result') {
          const result: ProbeResult = {
            at: event.at,
            ok: event.ok,
            ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
            ...(event.latencyMs !== undefined ? { latencyMs: event.latencyMs } : {}),
            ...(event.reason !== undefined ? { reason: event.reason } : {}),
          };
          const recentResults = [...monitor.recentResults, result].slice(-SPARK_HISTORY);
          // unknown → healthy has no dedicated event; first ok implies healthy.
          const state2 = monitor.state === 'unknown' && event.ok ? 'healthy' : monitor.state;
          return { ...monitor, lastResult: result, recentResults, state: state2 };
        }
        if (event.type === 'monitor.unhealthy') {
          return {
            ...monitor,
            state: 'unhealthy',
            consecutiveFailures: event.consecutiveFailures,
          };
        }
        return { ...monitor, state: 'healthy', consecutiveFailures: 0 };
      }),
    }));
  },
}));
