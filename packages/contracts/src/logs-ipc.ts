import { z } from 'zod';

/**
 * Renderer-facing log-watching types (PDD §17 path-capability model). The
 * renderer never sees or sends a real filesystem path: it receives opaque
 * `pathToken`s minted by Main and passes them back. This eliminates
 * renderer-originated path traversal by construction.
 */

export const selectedFileSchema = z.strictObject({
  pathToken: z.string().min(1),
  /** Safe-to-display path (Main owns the real one). */
  displayPath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export type SelectedFile = z.infer<typeof selectedFileSchema>;

export const recentFileSchema = z.strictObject({
  pathToken: z.string().min(1),
  displayPath: z.string().min(1),
});

export type RecentFile = z.infer<typeof recentFileSchema>;

export const startLogWatchInputSchema = z.strictObject({
  pathToken: z.string().min(1),
  fromEnd: z.boolean().default(true),
});

export type StartLogWatchInput = z.infer<typeof startLogWatchInputSchema>;

export const watchHandleSchema = z.strictObject({
  watchId: z.uuid(),
  displayPath: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().nonnegative(),
});

export type WatchHandle = z.infer<typeof watchHandleSchema>;

export const stopLogWatchInputSchema = z.strictObject({
  watchId: z.uuid(),
});

export type StopLogWatchInput = z.infer<typeof stopLogWatchInputSchema>;
