/**
 * Display formatting lives in the renderer; the wire carries raw numbers and
 * ISO strings (PDD §18). All outputs are stable-width friendly (tabular nums).
 */

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(1)} GB`;
  }
  if (bytes >= MIB) {
    return `${Math.round(bytes / MIB)} MB`;
  }
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }
  return `${value.toFixed(1)}%`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatLoadAvg(loadAvg: readonly [number, number, number]): string {
  return loadAvg.map((v) => v.toFixed(2)).join('  ');
}

/** Threshold tint for bars: quiet by default, loud when it matters (DESIGN.md). */
export function barLevel(percent: number): 'rest' | 'warn' | 'fail' {
  if (percent >= 90) {
    return 'fail';
  }
  if (percent >= 70) {
    return 'warn';
  }
  return 'rest';
}
