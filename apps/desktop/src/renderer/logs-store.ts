import { LIMITS } from '@deskpulse/contracts';
import { create } from 'zustand';

import { api } from './api.js';
import { stripAnsi } from './ansi.js';

import type { AgentEvent, WatchHandle } from '@deskpulse/contracts';

const RING = LIMITS.rendererLogRingBufferLines;

export interface LogRow {
  key: number;
  kind: 'line' | 'marker';
  text: string;
}

export type WatchStatus = 'active' | 'deleted' | 'error';

export interface WatchView {
  watchId: string;
  displayPath: string;
  rows: LogRow[];
  status: WatchStatus;
  statusMessage: string | undefined;
  droppedTotal: number;
}

let rowKeySeq = 1;

function marker(text: string): LogRow {
  return { key: rowKeySeq++, kind: 'marker', text };
}

interface LogsState {
  watches: Record<string, WatchView>;
  order: string[];
  activeWatchId: string | undefined;
  filter: string;
  addWatch: (handle: WatchHandle) => void;
  removeWatch: (watchId: string) => Promise<void>;
  setActive: (watchId: string) => void;
  setFilter: (filter: string) => void;
  remapWatches: (watchRemap: Record<string, string>) => void;
  ingest: (event: AgentEvent) => void;
}

export const useLogsStore = create<LogsState>((set, get) => ({
  watches: {},
  order: [],
  activeWatchId: undefined,
  filter: '',

  addWatch(handle) {
    set((state) => {
      if (state.watches[handle.watchId]) {
        return state;
      }
      const view: WatchView = {
        watchId: handle.watchId,
        displayPath: handle.displayPath,
        rows: [],
        status: 'active',
        statusMessage: undefined,
        droppedTotal: 0,
      };
      return {
        watches: { ...state.watches, [handle.watchId]: view },
        order: [...state.order, handle.watchId],
        activeWatchId: handle.watchId,
      };
    });
  },

  async removeWatch(watchId) {
    await api.stopLogWatch({ watchId }).catch(() => undefined);
    set((state) => {
      const rest = { ...state.watches };
      delete rest[watchId];
      const order = state.order.filter((id) => id !== watchId);
      return {
        watches: rest,
        order,
        activeWatchId:
          state.activeWatchId === watchId ? order[order.length - 1] : state.activeWatchId,
      };
    });
  },

  setActive(watchId) {
    set({ activeWatchId: watchId });
  },

  setFilter(filter) {
    set({ filter });
  },

  remapWatches(watchRemap) {
    // After an agent restart Main re-issued the watches under new ids (§28).
    // Re-key each open view to its new id so incoming lines land in the same
    // pane, and mark the resume point.
    set((state) => {
      const watches: Record<string, WatchView> = {};
      const order = state.order.map((id) => watchRemap[id] ?? id);
      for (const [id, view] of Object.entries(state.watches)) {
        const newId = watchRemap[id] ?? id;
        watches[newId] = appendRows(
          { ...view, watchId: newId, status: 'active', statusMessage: undefined },
          [marker('— agent restarted, resuming —')],
        );
      }
      const activeWatchId =
        state.activeWatchId === undefined
          ? undefined
          : (watchRemap[state.activeWatchId] ?? state.activeWatchId);
      return { watches, order, activeWatchId };
    });
  },

  ingest(event) {
    if (event.type === 'stream.reset') {
      // Main refetches snapshots; mark a gap on every open watch.
      set((state) => ({
        watches: mapWatches(state.watches, (view) => appendRows(view, [marker('— gap —')])),
      }));
      return;
    }
    if (!('watchId' in event)) {
      return;
    }
    const watchId = event.watchId;
    const view = get().watches[watchId];
    if (!view) {
      return;
    }

    let next: WatchView;
    switch (event.type) {
      case 'log.entry': {
        const rows = event.entries.map((entry): LogRow => ({
          key: rowKeySeq++,
          kind: 'line',
          text: stripAnsi(entry.line),
        }));
        next = appendRows(view, rows);
        next.droppedTotal += event.dropped;
        break;
      }
      case 'log.rotated':
        next = appendRows(view, [marker('— rotated —')]);
        next.status = 'active';
        next.statusMessage = undefined;
        break;
      case 'log.truncated':
        next = appendRows(view, [marker('— truncated —')]);
        break;
      case 'log.deleted':
        next = appendRows(view, [marker('— file deleted, watching for recreation —')]);
        next.status = 'deleted';
        break;
      case 'log.error':
        next = appendRows(view, [marker(`— error: ${event.error.message} —`)]);
        next.status = 'error';
        next.statusMessage = event.error.message;
        break;
      default:
        return;
    }

    set((state) => ({ watches: { ...state.watches, [watchId]: next } }));
  },
}));

function appendRows(view: WatchView, rows: LogRow[]): WatchView {
  const combined = view.rows.concat(rows);
  const trimmed = combined.length > RING ? combined.slice(combined.length - RING) : combined;
  return { ...view, rows: trimmed };
}

function mapWatches(
  watches: Record<string, WatchView>,
  fn: (view: WatchView) => WatchView,
): Record<string, WatchView> {
  const next: Record<string, WatchView> = {};
  for (const [id, view] of Object.entries(watches)) {
    next[id] = fn(view);
  }
  return next;
}
