import { DeskPulseError } from '@deskpulse/contracts';
import { useEffect, useState } from 'react';

import { api } from '../api.js';
import { useLogsStore } from '../logs-store.js';
import { LogViewer } from './LogViewer.js';

import type { RecentFile } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

export function LogsScreen(): ReactElement {
  const watches = useLogsStore((s) => s.watches);
  const order = useLogsStore((s) => s.order);
  const activeWatchId = useLogsStore((s) => s.activeWatchId);
  const filter = useLogsStore((s) => s.filter);
  const addWatch = useLogsStore((s) => s.addWatch);
  const removeWatch = useLogsStore((s) => s.removeWatch);
  const setActive = useLogsStore((s) => s.setActive);
  const setFilter = useLogsStore((s) => s.setFilter);

  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void api
      .getRecentLogFiles()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [order.length]);

  const openViaDialog = async (): Promise<void> => {
    setError(undefined);
    try {
      const selected = await api.selectLogFile();
      if (selected) {
        addWatch(await api.startLogWatch({ pathToken: selected.pathToken, fromEnd: true }));
      }
    } catch (err) {
      setError(err instanceof DeskPulseError ? err.message : String(err));
    }
  };

  const openRecent = async (file: RecentFile): Promise<void> => {
    setError(undefined);
    try {
      addWatch(await api.startLogWatch({ pathToken: file.pathToken, fromEnd: true }));
    } catch (err) {
      setError(err instanceof DeskPulseError ? err.message : String(err));
    }
  };

  const active = activeWatchId ? watches[activeWatchId] : undefined;

  if (order.length === 0) {
    return (
      <div className="logs-empty" data-testid="logs-empty">
        <p className="headline">Watch a log file</p>
        <p className="detail">
          Stream new lines as they are written. Rotation, truncation, and deletion are handled
          automatically.
        </p>
        <button type="button" className="primary-action" onClick={() => void openViaDialog()}>
          Open a log file…
        </button>
        {error && <p className="inline-error">{error}</p>}
        {recent.length > 0 && (
          <div className="mru">
            <p className="mru-label">Recent</p>
            {recent.map((file) => (
              <button
                key={file.pathToken}
                type="button"
                className="mru-item"
                onClick={() => void openRecent(file)}
              >
                {file.displayPath}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="logs-screen">
      <div className="logs-toolbar">
        <div className="watch-tabs" role="tablist">
          {order.map((id) => {
            const view = watches[id];
            if (!view) {
              return null;
            }
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === activeWatchId}
                className="watch-tab"
                data-status={view.status}
                onClick={() => setActive(id)}
                title={view.displayPath}
              >
                <span className="tab-dot" aria-hidden="true" />
                {basename(view.displayPath)}
                <span
                  className="tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${basename(view.displayPath)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeWatch(id);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
        </div>
        <div className="logs-controls">
          <input
            type="search"
            className="filter-box"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button type="button" className="secondary-action" onClick={() => void openViaDialog()}>
            Open…
          </button>
        </div>
      </div>

      {error && <p className="inline-error">{error}</p>}

      {active && (
        <>
          {active.droppedTotal > 0 && (
            <p className="drop-notice">
              {active.droppedTotal.toLocaleString()} lines dropped under load
            </p>
          )}
          <LogViewer rows={active.rows} filter={filter} />
        </>
      )}
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}
