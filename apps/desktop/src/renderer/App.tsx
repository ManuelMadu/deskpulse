import { useEffect, useState } from 'react';

import { api } from './api.js';
import { Metrics } from './components/Metrics.js';
import { ProcessTable } from './components/ProcessTable.js';
import { StatusPill } from './components/StatusPill.js';
import { LogsScreen } from './components/LogsScreen.js';
import { MonitorsScreen } from './components/MonitorsScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { useLogsStore } from './logs-store.js';
import { useMonitorsStore } from './monitors-store.js';
import { useDashboardStore } from './store.js';
import { usePolling } from './use-polling.js';

import type { AgentEvent } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

const REFRESH_INTERVAL_MS = 2_000; // PDD FR-3

type Screen = 'dashboard' | 'logs' | 'monitors' | 'settings';

/** Screens beyond these arrive with their phases (PDD §37). */
const FUTURE_NAV: { label: string; phase: string }[] = [{ label: 'Diagnostics', phase: '8' }];

function Dashboard(): ReactElement {
  const summary = useDashboardStore((s) => s.summary);
  const summaryError = useDashboardStore((s) => s.summaryError);
  const processes = useDashboardStore((s) => s.processes);
  const processesError = useDashboardStore((s) => s.processesError);
  const sortBy = useDashboardStore((s) => s.sortBy);
  const setSortBy = useDashboardStore((s) => s.setSortBy);
  const refresh = useDashboardStore((s) => s.refresh);

  return (
    <>
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
    </>
  );
}

export function App(): ReactElement {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const agent = useDashboardStore((s) => s.agent);
  const refresh = useDashboardStore((s) => s.refresh);
  const ingestLog = useLogsStore((s) => s.ingest);
  const ingestMonitor = useMonitorsStore((s) => s.ingest);

  // Poll at the shell level so the sidebar agent pill stays live on every
  // screen; the hook pauses entirely while the window is hidden (FR-3).
  usePolling(refresh, REFRESH_INTERVAL_MS);

  // One subscription to the forwarded agent event stream (PDD §18): log.*
  // events flow into the logs store, monitor.* into the monitors store.
  useEffect(() => {
    const route = (event: AgentEvent): void => {
      ingestLog(event);
      ingestMonitor(event);
    };
    return api.onAgentEvent(route);
  }, [ingestLog, ingestMonitor]);

  // Main can steer the renderer to a screen (PDD §25): a notification click
  // raises the window and jumps to Monitors.
  useEffect(() => api.onNavigate((target) => setScreen(target)), []);

  return (
    <div className="shell">
      <div className="drag-strip" aria-hidden="true" />

      <aside className="sidebar">
        <h1 className="wordmark">DeskPulse</h1>
        <nav className="nav" aria-label="Screens">
          <button
            type="button"
            className="nav-item"
            aria-current={screen === 'dashboard' ? 'page' : undefined}
            onClick={() => setScreen('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className="nav-item"
            aria-current={screen === 'logs' ? 'page' : undefined}
            onClick={() => setScreen('logs')}
          >
            Logs
          </button>
          <button
            type="button"
            className="nav-item"
            aria-current={screen === 'monitors' ? 'page' : undefined}
            onClick={() => setScreen('monitors')}
          >
            Monitors
          </button>
          <button
            type="button"
            className="nav-item"
            aria-current={screen === 'settings' ? 'page' : undefined}
            onClick={() => setScreen('settings')}
          >
            Settings
          </button>
          {FUTURE_NAV.map(({ label, phase }) => (
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
          ))}
        </nav>
        <div className="sidebar-foot">
          <StatusPill agent={agent} />
        </div>
      </aside>

      <main className="content">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'logs' && <LogsScreen />}
        {screen === 'monitors' && <MonitorsScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
