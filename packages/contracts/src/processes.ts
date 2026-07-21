import { z } from 'zod';

import { LIMITS } from './limits.js';

/** GET /processes query — coerced from URL search params, unknown keys rejected. */
export const processQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(LIMITS.processQueryLimitMin)
    .max(LIMITS.processQueryLimitMax)
    .default(LIMITS.processQueryLimitDefault),
  sortBy: z.enum(['cpu', 'memory']).default('cpu'),
});

export type ProcessQuery = z.infer<typeof processQuerySchema>;

export const processInfoSchema = z.strictObject({
  pid: z.number().int().positive(),
  /** Display name: basename of the executable. */
  name: z.string().min(1),
  /** ps pcpu — can exceed 100 on multi-core (per-process, not per-machine). */
  cpuPercent: z.number().nonnegative(),
  memoryRssBytes: z.number().int().nonnegative(),
});

export type ProcessInfo = z.infer<typeof processInfoSchema>;

/** GET /processes response (PDD §20). */
export const processesResponseSchema = z.strictObject({
  sampledAt: z.iso.datetime(),
  processes: z.array(processInfoSchema),
});

export type ProcessesResponse = z.infer<typeof processesResponseSchema>;
