import { useEffect, useState } from 'react';

import { useMonitorsStore } from '../monitors-store.js';
import { MonitorForm } from './MonitorForm.js';
import { MonitorSparkline } from './MonitorSparkline.js';

import type { AddMonitorInput, MonitorWithStatus } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

type SheetState =
  { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; monitor: MonitorWithStatus };

function statusLabel(monitor: MonitorWithStatus): { text: string; tone: string } {
  if (!monitor.enabled) {
    return { text: 'Paused', tone: 'paused' };
  }
  switch (monitor.state) {
    case 'healthy':
      return { text: 'Healthy', tone: 'ok' };
    case 'unhealthy':
      return { text: 'Unhealthy', tone: 'fail' };
    default:
      return { text: 'Unknown', tone: 'unknown' };
  }
}

function relativeTime(iso: string | undefined): string {
  if (!iso) {
    return '—';
  }
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function MonitorsScreen(): ReactElement {
  const monitors = useMonitorsStore((s) => s.monitors);
  const error = useMonitorsStore((s) => s.error);
  const loaded = useMonitorsStore((s) => s.loaded);
  const refresh = useMonitorsStore((s) => s.refresh);
  const add = useMonitorsStore((s) => s.add);
  const update = useMonitorsStore((s) => s.update);
  const remove = useMonitorsStore((s) => s.remove);

  const [sheet, setSheet] = useState<SheetState>({ mode: 'closed' });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (input: AddMonitorInput): Promise<void> => {
    if (sheet.mode === 'edit') {
      await update(sheet.monitor.id, input);
    } else {
      await add(input);
    }
    setSheet({ mode: 'closed' });
  };

  const togglePause = (monitor: MonitorWithStatus): void => {
    void update(monitor.id, { enabled: !monitor.enabled });
  };

  const confirmDelete = (monitor: MonitorWithStatus): void => {
    if (confirm(`Delete monitor "${monitor.name}"?`)) {
      void remove(monitor.id);
    }
  };

  return (
    <div className="monitors-screen">
      <div className="monitors-header">
        <h2 className="screen-title">Monitors</h2>
        <button type="button" className="primary-action" onClick={() => setSheet({ mode: 'add' })}>
          Add monitor
        </button>
      </div>

      {error && <p className="inline-error">{error}</p>}

      {loaded && monitors.length === 0 ? (
        <div className="monitors-empty" data-testid="monitors-empty">
          <p className="headline">No monitors yet</p>
          <p className="detail">
            Add a local service URL and DeskPulse will check it on a schedule, flagging it when it
            stops answering.
          </p>
        </div>
      ) : (
        <table className="monitors-table" data-testid="monitors-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              <th scope="col">URL</th>
              <th scope="col" className="num">
                Latency
              </th>
              <th scope="col">Checked</th>
              <th scope="col">Recent</th>
              <th scope="col" className="actions-col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {monitors.map((monitor) => {
              const status = statusLabel(monitor);
              return (
                <tr key={monitor.id} data-testid="monitor-row" data-status={status.tone}>
                  <td>
                    <span className="status-chip" data-tone={status.tone}>
                      <span className="chip-dot" aria-hidden="true" />
                      {status.text}
                    </span>
                  </td>
                  <td className="monitor-name">{monitor.name}</td>
                  <td className="monitor-url" title={monitor.url}>
                    {monitor.url}
                  </td>
                  <td className="num">
                    {monitor.lastResult?.latencyMs !== undefined
                      ? `${monitor.lastResult.latencyMs} ms`
                      : '—'}
                  </td>
                  <td className="checked">{relativeTime(monitor.lastResult?.at)}</td>
                  <td>
                    <MonitorSparkline results={monitor.recentResults} />
                  </td>
                  <td className="row-actions">
                    <button type="button" onClick={() => togglePause(monitor)}>
                      {monitor.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" onClick={() => setSheet({ mode: 'edit', monitor })}>
                      Edit
                    </button>
                    <button type="button" className="danger" onClick={() => confirmDelete(monitor)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {sheet.mode !== 'closed' && (
        <MonitorForm
          monitor={sheet.mode === 'edit' ? sheet.monitor : undefined}
          onSubmit={submit}
          onCancel={() => setSheet({ mode: 'closed' })}
        />
      )}
    </div>
  );
}
