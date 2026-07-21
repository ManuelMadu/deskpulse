import { z } from 'zod';

/**
 * Service health monitors (PDD §10 FR-9…13, §20, §25). URLs are loopback-only
 * for the MVP (OD-6): matches "local HTTP services" and keeps the app from
 * being usable as a port scanner.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// scheme + host, where host is either a bracketed IPv6 or a run without any
// url delimiter. Parsed by regex so contracts stays free of the URL global
// (this package must not depend on Node or DOM libs).
const URL_HEAD = /^(https?):\/\/(\[[^\]]+\]|[^/:?#@]+)(?::\d+)?(?:[/?#]|$)/i;

export function isLoopbackUrl(raw: string): boolean {
  const match = URL_HEAD.exec(raw.trim());
  if (!match) {
    return false;
  }
  const host = match[2]!.replace(/^\[|\]$/g, '').toLowerCase();
  return LOOPBACK_HOSTS.has(host);
}

export const expectedStatusSchema = z
  .strictObject({
    min: z.number().int().min(100).max(599),
    max: z.number().int().min(100).max(599),
  })
  .refine((r) => r.min <= r.max, { message: 'expectedStatus.min must be ≤ max' });

export type ExpectedStatus = z.infer<typeof expectedStatusSchema>;

/** Fields a user supplies to create a monitor (PDD FR-9). */
export const monitorConfigInputSchema = z.strictObject({
  name: z.string().min(1).max(60),
  url: z.string().refine(isLoopbackUrl, {
    message: 'URL must be http/https on localhost, 127.0.0.1, or [::1] (MVP).',
  }),
  method: z.enum(['GET', 'HEAD']).default('GET'),
  intervalSeconds: z.number().int().min(5).max(3600).default(30),
  timeoutMs: z.number().int().min(500).max(30000).default(5000),
  expectedStatus: expectedStatusSchema.default({ min: 200, max: 399 }),
  failureThreshold: z.number().int().min(1).max(10).default(3),
  recoveryThreshold: z.number().int().min(1).max(10).default(1),
  enabled: z.boolean().default(true),
});

export type MonitorConfigInput = z.infer<typeof monitorConfigInputSchema>;

/** Partial update; every field optional, unknown fields rejected. */
export const monitorPatchSchema = z
  .strictObject({
    name: z.string().min(1).max(60),
    url: z.string().refine(isLoopbackUrl, { message: 'URL must be loopback http/https.' }),
    method: z.enum(['GET', 'HEAD']),
    intervalSeconds: z.number().int().min(5).max(3600),
    timeoutMs: z.number().int().min(500).max(30000),
    expectedStatus: expectedStatusSchema,
    failureThreshold: z.number().int().min(1).max(10),
    recoveryThreshold: z.number().int().min(1).max(10),
    enabled: z.boolean(),
  })
  .partial();

export type MonitorPatch = z.infer<typeof monitorPatchSchema>;

export const monitorStateSchema = z.enum(['unknown', 'healthy', 'unhealthy']);
export type MonitorState = z.infer<typeof monitorStateSchema>;

export const probeFailureReasonSchema = z.enum([
  'timeout',
  'connection-refused',
  'dns',
  'tls',
  'unexpected-status',
  'aborted',
]);
export type ProbeFailureReason = z.infer<typeof probeFailureReasonSchema>;

export const probeResultSchema = z.strictObject({
  at: z.iso.datetime(),
  ok: z.boolean(),
  statusCode: z.number().int().optional(),
  latencyMs: z.number().nonnegative().optional(),
  reason: probeFailureReasonSchema.optional(),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;

/** A monitor plus its live runtime status (GET /monitors, POST/PATCH responses). */
export const monitorWithStatusSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  method: z.enum(['GET', 'HEAD']),
  intervalSeconds: z.number().int(),
  timeoutMs: z.number().int(),
  expectedStatus: z.strictObject({ min: z.number().int(), max: z.number().int() }),
  failureThreshold: z.number().int(),
  recoveryThreshold: z.number().int(),
  enabled: z.boolean(),
  state: monitorStateSchema,
  consecutiveFailures: z.number().int().nonnegative(),
  lastResult: probeResultSchema.optional(),
  recentResults: z.array(probeResultSchema),
});
export type MonitorWithStatus = z.infer<typeof monitorWithStatusSchema>;
