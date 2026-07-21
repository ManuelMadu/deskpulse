import { formatBytes, formatPercent } from '../format.js';

import type { SurfaceError } from '../store.js';
import type { ProcessInfo } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

export function ProcessTable({
  processes,
  error,
  sortBy,
  onSort,
  onRetry,
}: {
  processes: ProcessInfo[];
  error: SurfaceError | undefined;
  sortBy: 'cpu' | 'memory';
  onSort: (sortBy: 'cpu' | 'memory') => void;
  onRetry: () => void;
}): ReactElement {
  if (error && processes.length === 0) {
    return (
      <div className="state-block" data-testid="process-error">
        <p className="headline">Processes unavailable</p>
        <p className="detail">{error.message}</p>
        {error.retryable && (
          <button type="button" className="retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (processes.length === 0) {
    return (
      <div className="state-block">
        <p className="detail">Waiting for the first process sample…</p>
      </div>
    );
  }

  return (
    <div className="process-scroll">
      <table className="process-table" data-testid="process-table">
        <thead>
          <tr>
            <th scope="col">Process</th>
            <th scope="col" className="num">
              PID
            </th>
            <th scope="col" className="num" aria-sort={sortBy === 'cpu' ? 'descending' : undefined}>
              <button type="button" onClick={() => onSort('cpu')}>
                CPU {sortBy === 'cpu' ? '↓' : ''}
              </button>
            </th>
            <th
              scope="col"
              className="num"
              aria-sort={sortBy === 'memory' ? 'descending' : undefined}
            >
              <button type="button" onClick={() => onSort('memory')}>
                Memory {sortBy === 'memory' ? '↓' : ''}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {processes.map((process) => (
            <tr key={process.pid} data-testid="process-row">
              <td className="name" title={process.name}>
                {process.name}
              </td>
              <td className="num pid">{process.pid}</td>
              <td className="num">{formatPercent(process.cpuPercent)}</td>
              <td className="num mem">{formatBytes(process.memoryRssBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
