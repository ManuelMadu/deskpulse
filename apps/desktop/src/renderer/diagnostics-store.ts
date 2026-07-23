import { create } from 'zustand';

import type { AgentEvent, DiagnosticsStage } from '@deskpulse/contracts';

/**
 * Diagnostics export progress (PDD §27). Fed by the forwarded
 * diagnostics.progress events; the screen renders the current stage/percent and
 * the terminal done/failed state. Main moves the finished ZIP to ~/Downloads.
 */
export interface ExportProgress {
  exportId: string;
  stage: DiagnosticsStage;
  percent: number;
  error: string | undefined;
}

interface DiagnosticsState {
  progress: ExportProgress | undefined;
  /** Set optimistically when the user starts an export, before events arrive. */
  begin: (exportId: string) => void;
  ingest: (event: AgentEvent) => void;
  reset: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  progress: undefined,

  begin(exportId) {
    set({ progress: { exportId, stage: 'collect', percent: 0, error: undefined } });
  },

  ingest(event) {
    if (event.type !== 'diagnostics.progress') {
      return;
    }
    // Ignore progress for an export we didn't start (defensive).
    const current = get().progress;
    if (current && current.exportId !== event.exportId && event.stage !== 'done') {
      return;
    }
    set({
      progress: {
        exportId: event.exportId,
        stage: event.stage,
        percent: event.percent,
        error: event.error?.message,
      },
    });
  },

  reset() {
    set({ progress: undefined });
  },
}));
