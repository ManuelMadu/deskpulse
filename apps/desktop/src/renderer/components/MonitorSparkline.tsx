import type { ProbeResult } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

/** Pass/fail ticks for the last N probes — the full extent of "charting" (PDD §12). */
export function MonitorSparkline({ results }: { results: ProbeResult[] }): ReactElement {
  const ticks = results.slice(-20);
  return (
    <span className="sparkline" aria-hidden="true">
      {ticks.map((r, i) => (
        <span key={i} className={r.ok ? 'tick ok' : 'tick fail'} />
      ))}
    </span>
  );
}
