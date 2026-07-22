import type { HealthSnapshot, MonitorLine, TrayHealth } from './health-state.js';

/**
 * Pure presentation for the menu-bar tray (PDD §16 tray.ts). Turns an
 * aggregate HealthSnapshot into the strings the Tray renders — icon state,
 * hover tooltip, the status summary line, and up to five per-monitor rows with
 * an "n more…" overflow. No Electron here so the wording is unit-tested.
 */

/** How many monitors to list before collapsing the rest into "n more…". */
export const MAX_MONITOR_ROWS = 5;

export interface TrayMonitorRow {
  label: string;
  state: MonitorLine['state'];
}

export interface TrayView {
  icon: TrayHealth;
  tooltip: string;
  statusLine: string;
  monitorRows: TrayMonitorRow[];
  /** Monitors beyond MAX_MONITOR_ROWS, surfaced as a disabled "n more…" row. */
  overflowCount: number;
}

const STATE_LABEL: Record<MonitorLine['state'], string> = {
  healthy: 'Healthy',
  unhealthy: 'Unhealthy',
  unknown: 'Checking…',
};

export function buildTrayView(snapshot: HealthSnapshot): TrayView {
  const statusLine = statusSummary(snapshot);
  const shown = snapshot.monitors.slice(0, MAX_MONITOR_ROWS);
  const monitorRows = shown.map((monitor) => ({
    label: `${monitor.name} — ${STATE_LABEL[monitor.state]}`,
    state: monitor.state,
  }));
  return {
    icon: snapshot.health,
    tooltip: `DeskPulse — ${statusLine}`,
    statusLine,
    monitorRows,
    overflowCount: Math.max(0, snapshot.monitors.length - MAX_MONITOR_ROWS),
  };
}

function statusSummary(snapshot: HealthSnapshot): string {
  if (!snapshot.agentUp) {
    return 'Agent not running';
  }
  const parts: string[] = [];
  if (snapshot.unhealthyCount > 0) {
    parts.push(
      `${snapshot.unhealthyCount} monitor${snapshot.unhealthyCount === 1 ? '' : 's'} unhealthy`,
    );
  }
  if (snapshot.erroredWatchCount > 0) {
    parts.push(
      `${snapshot.erroredWatchCount} log${snapshot.erroredWatchCount === 1 ? '' : 's'} in error`,
    );
  }
  if (parts.length === 0) {
    return snapshot.monitors.length === 0 ? 'All systems nominal' : 'All monitors healthy';
  }
  return parts.join(', ');
}
