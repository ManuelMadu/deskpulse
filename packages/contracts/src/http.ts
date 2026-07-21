import { z } from 'zod';

/**
 * HTTP response schemas for the agent API (PDD §20). Every schema is strict:
 * unknown fields are a contract violation on both sides of the wire — the
 * agent rejects them in requests, Main rejects them in responses
 * (MALFORMED_RESPONSE) rather than letting undefined propagate.
 */

const isoDateTime = z.iso.datetime();

/** GET /health — liveness + readiness; used by the supervisor handshake. */
export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  pid: z.number().int().positive(),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  activeWatches: z.number().int().nonnegative(),
  activeMonitors: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** GET /system — latest cached metrics sample. */
export const systemSummarySchema = z.strictObject({
  sampledAt: isoDateTime,
  cpu: z.strictObject({
    /** 0–100 across all cores combined. */
    overallPercent: z.number().min(0).max(100),
    /** 0–100 per core; length = core count. */
    perCorePercent: z.array(z.number().min(0).max(100)).min(1),
    /** 1/5/15-minute load averages. */
    loadAvg: z.tuple([
      z.number().nonnegative(),
      z.number().nonnegative(),
      z.number().nonnegative(),
    ]),
  }),
  memory: z.strictObject({
    totalBytes: z.number().int().nonnegative(),
    /** Approximated as total − free on macOS; the UI labels it "approx. used". */
    usedBytes: z.number().int().nonnegative(),
    freeBytes: z.number().int().nonnegative(),
  }),
  uptimeSeconds: z.number().nonnegative(),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
});

export type SystemSummary = z.infer<typeof systemSummarySchema>;
