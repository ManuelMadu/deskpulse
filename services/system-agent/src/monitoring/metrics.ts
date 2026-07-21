import { cpus, freemem, hostname, loadavg, totalmem, uptime } from 'node:os';

import type { SystemSummary } from '@deskpulse/contracts';

/** Default sampling cadence (PDD FR-1). */
export const METRICS_INTERVAL_MS = 2_000;

/** One core's cumulative tick counters, as reported by os.cpus()[i].times. */
export interface CpuTicks {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface CpuPercents {
  overallPercent: number;
  perCorePercent: number[];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/**
 * Busy-percentage from two cumulative tick readings. Deltas are clamped to
 * ≥ 0 because counters can jump backwards across sleep/wake (PDD §26, risk
 * C-8); a zero total delta reports 0 % rather than NaN.
 */
export function computeCpuPercents(previous: CpuTicks[], next: CpuTicks[]): CpuPercents {
  const coreCount = Math.min(previous.length, next.length);
  const perCorePercent: number[] = [];
  let busyTotal = 0;
  let allTotal = 0;

  for (let i = 0; i < coreCount; i += 1) {
    const prev = previous[i]!;
    const curr = next[i]!;
    const busy =
      Math.max(0, curr.user - prev.user) +
      Math.max(0, curr.nice - prev.nice) +
      Math.max(0, curr.sys - prev.sys) +
      Math.max(0, curr.irq - prev.irq);
    const idle = Math.max(0, curr.idle - prev.idle);
    const total = busy + idle;

    perCorePercent.push(total === 0 ? 0 : clampPercent((busy / total) * 100));
    busyTotal += busy;
    allTotal += total;
  }

  return {
    overallPercent: allTotal === 0 ? 0 : clampPercent((busyTotal / allTotal) * 100),
    perCorePercent,
  };
}

export function readCpuTicks(): CpuTicks[] {
  return cpus().map((core) => ({
    user: core.times.user,
    nice: core.times.nice,
    sys: core.times.sys,
    idle: core.times.idle,
    irq: core.times.irq,
  }));
}

/**
 * Samples metrics on a fixed cadence and serves the latest summary from
 * cache — GET /system never blocks on sampling (PDD §20). Needs two tick
 * readings for a CPU delta, so the first summary appears one interval after
 * start; until then the route answers NOT_READY.
 */
export class MetricsSampler {
  private previousTicks: CpuTicks[] | undefined;
  private summary: SystemSummary | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly intervalMs: number = METRICS_INTERVAL_MS) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.previousTicks = readCpuTicks();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  latest(): SystemSummary | undefined {
    return this.summary;
  }

  private sample(): void {
    const ticks = readCpuTicks();
    const cpu = computeCpuPercents(this.previousTicks ?? ticks, ticks);
    this.previousTicks = ticks;

    const totalBytes = totalmem();
    const freeBytes = freemem();
    const [load1 = 0, load5 = 0, load15 = 0] = loadavg();

    this.summary = {
      sampledAt: new Date().toISOString(),
      cpu: {
        overallPercent: cpu.overallPercent,
        perCorePercent: cpu.perCorePercent,
        loadAvg: [Math.max(0, load1), Math.max(0, load5), Math.max(0, load15)],
      },
      memory: {
        totalBytes,
        // macOS "used" is approximate (compressed/cached memory); the UI
        // labels it accordingly (PDD §20).
        usedBytes: Math.max(0, totalBytes - freeBytes),
        freeBytes,
      },
      uptimeSeconds: uptime(),
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
    };
  }
}
