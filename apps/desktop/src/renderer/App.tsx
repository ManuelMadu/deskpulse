import { Metrics } from './components/Metrics.js';
import { ProcessTable } from './components/ProcessTable.js';
import { StatusPill } from './components/StatusPill.js';
import { useDashboardStore } from './store.js';
import { usePolling } from './use-polling.js';

import type { ReactElement } from 'react';

const REFRESH_INTERVAL_MS = 2_000; // PDD FR-3

/** Screens beyond Dashboard arrive with their phases (PDD §37). */
const NAV_ITEMS: { label: string; phase?: string }[] = [
  { label: 'Dashboard' },
  { label: 'Logs', phase: '4' },
  { label: 'Monitors', phase: '5' },
  { label: 'Diagnostics', phase: '8' },
  { label: 'Settings', phase: '6' },
];

export function App(): ReactElement {
  const agent = useDashboardStore((s) => s.agent);
  const summary = useDashboardStore((s) => s.summary);
  const summaryError = useDashboardStore((s) => s.summaryError);
  const processes = useDashboardStore((s) => s.processes);
  const processesError = useDashboardStore((s) => s.processesError);
  const sortBy = useDashboardStore((s) => s.sortBy);
  const setSortBy = useDashboardStore((s) => s.setSortBy);
  const refresh = useDashboardStore((s) => s.refresh);

  usePolling(refresh, REFRESH_INTERVAL_MS);

  return (
    <div className="shell">
      <div className="drag-strip" aria-hidden="true" />

      <aside className="sidebar">
        <h1 className="wordmark">DeskPulse</h1>
        <nav className="nav" aria-label="Screens">
          {NAV_ITEMS.map(({ label, phase }) =>
            phase === undefined ? (
              <button key={label} type="button" className="nav-item" aria-current="page">
                {label}
              </button>
            ) : (
              <button
                key={label}
                type="button"
                className="nav-item"
                disabled
                title={`Arrives in Phase ${phase}`}
              >
                {label}
                <span className="phase-tag">P{phase}</span>
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-foot">
          <StatusPill agent={agent} />
        </div>
      </aside>

      <main className="dashboard">
        <Metrics summary={summary} error={summaryError} />
        <section className="process-section" aria-label="Top processes">
          <ProcessTable
            processes={processes}
            error={processesError}
            sortBy={sortBy}
            onSort={setSortBy}
            onRetry={() => void refresh()}
          />
        </section>
      </main>
    </div>
  );
}
