import { barLevel, formatBytes, formatLoadAvg, formatPercent, formatUptime } from '../format.js';

import type { SurfaceError } from '../store.js';
import type { SystemSummary } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

function CoreBars({ perCore }: { perCore: number[] }): ReactElement {
  return (
    <div className="core-bars" role="list" aria-label="Per-core CPU usage">
      {perCore.map((percent, index) => (
        <div
          className="core-bar"
          role="listitem"
          aria-label={`Core ${index + 1}: ${formatPercent(percent)}`}
          key={index}
        >
          <span
            className="fill"
            data-level={barLevel(percent) === 'rest' ? undefined : barLevel(percent)}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The metrics band: one big honest number, per-core bars, memory with its
 * "approx." caveat, and host facts. No cards — whitespace and hairlines
 * (DESIGN.md layout).
 */
export function Metrics({
  summary,
  error,
}: {
  summary: SystemSummary | undefined;
  error: SurfaceError | undefined;
}): ReactElement {
  if (!summary) {
    const warming = error?.code === 'NOT_READY' || error?.code === 'AGENT_UNAVAILABLE' || !error;
    return (
      <div className="metrics-band">
        <div>
          <p className="metric-label">CPU</p>
          <div className="cpu-overall placeholder-value" data-testid="cpu-overall">
            —
          </div>
          <p className="metric-caption">
            {warming ? 'Waiting for the first sample…' : (error?.message ?? '')}
          </p>
        </div>
        <div>
          <p className="metric-label">Memory</p>
          <div className="mem-value placeholder-value">—</div>
        </div>
      </div>
    );
  }

  const memPercent = (summary.memory.usedBytes / Math.max(1, summary.memory.totalBytes)) * 100;

  return (
    <div className="metrics-band">
      <div>
        <p className="metric-label">CPU</p>
        <div className="cpu-overall" data-testid="cpu-overall">
          {summary.cpu.overallPercent.toFixed(1)}
          <span className="unit">%</span>
        </div>
        <p className="load-caption">load {formatLoadAvg(summary.cpu.loadAvg)}</p>
        <CoreBars perCore={summary.cpu.perCorePercent} />
      </div>

      <div>
        <p className="metric-label">Memory</p>
        <div className="mem-value">
          {formatBytes(summary.memory.usedBytes)}
          <span className="of-total"> / {formatBytes(summary.memory.totalBytes)}</span>
        </div>
        <div
          className="mem-bar"
          role="img"
          aria-label={`Memory: ${formatPercent(memPercent)} used (approximate)`}
        >
          <span
            className="fill"
            data-level={barLevel(memPercent) === 'rest' ? undefined : barLevel(memPercent)}
            style={{ width: `${Math.min(100, memPercent)}%` }}
          />
        </div>
        <p className="metric-caption">
          approx. used · {formatBytes(summary.memory.freeBytes)} free
        </p>
      </div>

      <div className="host-facts">
        <span className="primary">{summary.hostname}</span>
        <span>
          {summary.platform} · {summary.arch}
        </span>
        <span>up {formatUptime(summary.uptimeSeconds)}</span>
      </div>
    </div>
  );
}
