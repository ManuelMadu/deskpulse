import { z } from 'zod';

/**
 * App settings surfaced to the renderer (PDD §13/§29). The OS is the source of
 * truth for launch-at-login — Main reads it back after every write rather than
 * trusting a cached value — so the settings screen always reflects reality.
 */
export const appSettingsSchema = z.strictObject({
  launchAtLogin: z.boolean(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Renderer→Main request to toggle the login item (PDD §17). */
export const setLaunchAtLoginInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export type SetLaunchAtLoginInput = z.infer<typeof setLaunchAtLoginInputSchema>;
