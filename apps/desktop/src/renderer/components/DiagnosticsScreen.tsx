import { useState } from 'react';

import { api } from '../api.js';
import { useDiagnosticsStore } from '../diagnostics-store.js';
import { DeskPulseError } from '@deskpulse/contracts';

import type { ReactElement } from 'react';

/**
 * Diagnostics export screen (PDD §27, UC5). Choose the toggles, click Export,
 * watch the streamed progress; Main drops the finished ZIP in ~/Downloads and
 * reveals it in Finder.
 */
export function DiagnosticsScreen(): ReactElement {
  const progress = useDiagnosticsStore((s) => s.progress);
  const begin = useDiagnosticsStore((s) => s.begin);
  const reset = useDiagnosticsStore((s) => s.reset);

  const [includeHealthHistory, setIncludeHealthHistory] = useState(true);
  const [redactAgentLogs, setRedactAgentLogs] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);

  const running =
    progress !== undefined && progress.stage !== 'done' && progress.stage !== 'failed';

  const start = async (): Promise<void> => {
    setStartError(null);
    reset();
    try {
      const { exportId } = await api.startExport({ includeHealthHistory, redactAgentLogs });
      begin(exportId);
    } catch (error) {
      setStartError(
        error instanceof DeskPulseError ? error.message : 'Could not start the export.',
      );
    }
  };

  return (
    <div className="diagnostics-screen">
      <div className="monitors-header">
        <h2 className="screen-title">Diagnostics</h2>
        <button
          type="button"
          className="primary-action"
          data-testid="export-diagnostics"
          disabled={running}
          onClick={() => void start()}
        >
          {running ? 'Exporting…' : 'Export diagnostics'}
        </button>
      </div>

      <p className="diagnostics-intro">
        Bundles system info, DeskPulse logs, and monitor history into a ZIP saved to your Downloads
        folder and revealed in Finder.
      </p>

      <section className="setting-group" aria-label="Export options">
        <label className="setting-row">
          <input
            type="checkbox"
            checked={redactAgentLogs}
            disabled={running}
            onChange={(e) => setRedactAgentLogs(e.target.checked)}
          />
          <span className="setting-copy">
            <span className="setting-name">Redact secrets from DeskPulse logs</span>
            <span className="setting-caveat">
              Masks tokens, passwords, and keys in DeskPulse’s own logs and monitor history. Any log
              files you add yourself are always included verbatim.
            </span>
          </span>
        </label>
        <label className="setting-row">
          <input
            type="checkbox"
            checked={includeHealthHistory}
            disabled={running}
            onChange={(e) => setIncludeHealthHistory(e.target.checked)}
          />
          <span className="setting-copy">
            <span className="setting-name">Include monitor probe history</span>
            <span className="setting-caveat">Recent pass/fail results for each monitor.</span>
          </span>
        </label>
      </section>

      {startError && <p className="inline-error">{startError}</p>}

      {progress && (
        <div className="export-progress" data-testid="export-progress" data-stage={progress.stage}>
          {progress.stage === 'done' ? (
            <p className="export-status ok">
              Export complete — saved to Downloads and revealed in Finder.
            </p>
          ) : progress.stage === 'failed' ? (
            <p className="export-status fail">
              Export failed{progress.error ? `: ${progress.error}` : '.'}
            </p>
          ) : (
            <>
              <div className="export-bar" aria-hidden="true">
                <span style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="export-status">
                {progress.stage === 'collect' ? 'Collecting…' : 'Compressing…'} {progress.percent}%
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
