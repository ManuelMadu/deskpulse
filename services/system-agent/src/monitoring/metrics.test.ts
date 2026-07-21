import { systemSummarySchema } from '@deskpulse/contracts';
import { describe, expect, it } from 'vitest';

import { MetricsSampler, computeCpuPercents } from './metrics.js';

import type { CpuTicks } from './metrics.js';

const ticks = (user: number, sys: number, idle: number): CpuTicks => ({
  user,
  nice: 0,
  sys,
  idle,
  irq: 0,
});

describe('computeCpuPercents (fixture tick tables)', () => {
  it('computes overall and per-core busy percentages from deltas', () => {
    const prev = [ticks(100, 50, 850), ticks(200, 100, 700)];
    const next = [ticks(150, 75, 900), ticks(400, 200, 700)];
    // core 0: busy 75, idle 50 → 60 % ; core 1: busy 300, idle 0 → 100 %
    const result = computeCpuPercents(prev, next);
    expect(result.perCorePercent[0]).toBeCloseTo(60);
    expect(result.perCorePercent[1]).toBeCloseTo(100);
    // overall: busy 375 of total 425 ≈ 88.24 %
    expect(result.overallPercent).toBeCloseTo(88.235, 2);
  });

  it('reports 0 % for a zero total delta instead of NaN', () => {
    const same = [ticks(100, 50, 850)];
    const result = computeCpuPercents(same, same);
    expect(result.overallPercent).toBe(0);
    expect(result.perCorePercent).toEqual([0]);
  });

  it('clamps backwards counter jumps (sleep/wake) to 0 busy', () => {
    const prev = [ticks(1000, 500, 8500)];
    const next = [ticks(900, 400, 9000)]; // user/sys went backwards
    const result = computeCpuPercents(prev, next);
    expect(result.overallPercent).toBe(0);
    expect(result.perCorePercent).toEqual([0]);
  });

  it('never exceeds 100 % and never goes negative', () => {
    const prev = [ticks(0, 0, 100)];
    const next = [ticks(10_000, 10_000, 100)]; // idle frozen, huge busy delta
    const result = computeCpuPercents(prev, next);
    expect(result.overallPercent).toBe(100);
    expect(result.perCorePercent[0]).toBe(100);
  });

  it('handles core-count changes by using the smaller set', () => {
    const prev = [ticks(0, 0, 100), ticks(0, 0, 100)];
    const next = [ticks(50, 0, 150)];
    const result = computeCpuPercents(prev, next);
    expect(result.perCorePercent).toHaveLength(1);
  });
});

describe('MetricsSampler', () => {
  it('has no summary before the first interval, then serves a contract-valid one', async () => {
    const sampler = new MetricsSampler(50);
    try {
      sampler.start();
      expect(sampler.latest()).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 150));
      const summary = sampler.latest();
      expect(summary).toBeDefined();
      const parsed = systemSummarySchema.parse(summary);
      expect(parsed.cpu.perCorePercent.length).toBeGreaterThan(0);
      expect(parsed.memory.totalBytes).toBeGreaterThan(0);
      expect(parsed.platform).toBe(process.platform);
    } finally {
      sampler.stop();
    }
  });

  it('stop() halts sampling', async () => {
    const sampler = new MetricsSampler(30);
    sampler.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    sampler.stop();
    const frozen = sampler.latest()?.sampledAt;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sampler.latest()?.sampledAt).toBe(frozen);
  });
});
