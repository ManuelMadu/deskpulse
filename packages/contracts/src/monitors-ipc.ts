import { z } from 'zod';

import { monitorConfigInputSchema, monitorPatchSchema } from './monitors.js';

/**
 * Renderer→Main monitor IPC payloads (PDD §17). Update and remove carry the
 * monitor id; add carries the full config; Main re-validates authoritatively.
 */
export const addMonitorInputSchema = monitorConfigInputSchema;
export type AddMonitorInput = z.infer<typeof addMonitorInputSchema>;

export const updateMonitorInputSchema = z.strictObject({
  id: z.uuid(),
  patch: monitorPatchSchema,
});
export type UpdateMonitorInput = z.infer<typeof updateMonitorInputSchema>;

export const removeMonitorInputSchema = z.strictObject({
  id: z.uuid(),
});
export type RemoveMonitorInput = z.infer<typeof removeMonitorInputSchema>;
