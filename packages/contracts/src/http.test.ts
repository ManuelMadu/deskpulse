import { describe, expect, it } from 'vitest';

import healthFixture from './fixtures/health-response.json' with { type: 'json' };
import systemFixture from './fixtures/system-summary.json' with { type: 'json' };
import { healthResponseSchema, systemSummarySchema } from './http.js';

describe('GET /health response schema', () => {
  it('round-trips the documented fixture (PDD §20)', () => {
    expect(healthResponseSchema.parse(healthFixture)).toEqual(healthFixture);
  });

  it('rejects unknown fields', () => {
    expect(healthResponseSchema.safeParse({ ...healthFixture, degraded: false }).success).toBe(
      false,
    );
  });

  it('rejects non-ok status and invalid counters', () => {
    expect(healthResponseSchema.safeParse({ ...healthFixture, status: 'meh' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...healthFixture, pid: 0 }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...healthFixture, activeWatches: -1 }).success).toBe(
      false,
    );
    expect(healthResponseSchema.safeParse({ ...healthFixture, activeWatches: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('GET /system response schema', () => {
  it('round-trips the documented fixture (PDD §20)', () => {
    expect(systemSummarySchema.parse(systemFixture)).toEqual(systemFixture);
  });

  it('rejects unknown fields at every nesting level', () => {
    expect(systemSummarySchema.safeParse({ ...systemFixture, extra: 1 }).success).toBe(false);
    expect(
      systemSummarySchema.safeParse({
        ...systemFixture,
        cpu: { ...systemFixture.cpu, temperature: 60 },
      }).success,
    ).toBe(false);
    expect(
      systemSummarySchema.safeParse({
        ...systemFixture,
        memory: { ...systemFixture.memory, swapBytes: 0 },
      }).success,
    ).toBe(false);
  });

  it('bounds CPU percentages to 0–100', () => {
    for (const overallPercent of [-0.1, 100.1]) {
      expect(
        systemSummarySchema.safeParse({
          ...systemFixture,
          cpu: { ...systemFixture.cpu, overallPercent },
        }).success,
      ).toBe(false);
    }
    for (const edge of [0, 100]) {
      expect(
        systemSummarySchema.safeParse({
          ...systemFixture,
          cpu: { ...systemFixture.cpu, overallPercent: edge },
        }).success,
      ).toBe(true);
    }
  });

  it('requires exactly three load averages and at least one core', () => {
    expect(
      systemSummarySchema.safeParse({
        ...systemFixture,
        cpu: { ...systemFixture.cpu, loadAvg: [1, 2] },
      }).success,
    ).toBe(false);
    expect(
      systemSummarySchema.safeParse({
        ...systemFixture,
        cpu: { ...systemFixture.cpu, perCorePercent: [] },
      }).success,
    ).toBe(false);
  });

  it('rejects timestamps that are not ISO-8601', () => {
    expect(
      systemSummarySchema.safeParse({ ...systemFixture, sampledAt: '21/07/2026 10:15' }).success,
    ).toBe(false);
  });

  it('rejects fractional byte counts', () => {
    expect(
      systemSummarySchema.safeParse({
        ...systemFixture,
        memory: { ...systemFixture.memory, usedBytes: 1.5 },
      }).success,
    ).toBe(false);
  });
});
