import { z } from 'zod';

/**
 * POST /watch — start tailing (PDD §20). The path always originates from
 * Main (user-selected via the native dialog); the agent still validates:
 * absolute, exists, regular file, readable.
 */
export const startWatchRequestSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith('/'), { message: 'path must be absolute' }),
  fromEnd: z.boolean().default(true),
  encoding: z.enum(['utf8', 'latin1']).default('utf8'),
});

export type StartWatchRequest = z.infer<typeof startWatchRequestSchema>;

/** 201 response: the resolved reality of what is actually being watched. */
export const watchCreatedSchema = z.strictObject({
  id: z.uuid(),
  path: z.string().min(1),
  /** Symlinks resolved once at registration; this is what gets watched. */
  realPath: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().nonnegative(),
});

export type WatchCreated = z.infer<typeof watchCreatedSchema>;
