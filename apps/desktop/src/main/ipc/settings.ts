import { setLaunchAtLoginInputSchema } from '@deskpulse/contracts';

import type { LaunchAtLoginController } from '../platform/launch-at-login.js';
import type { AppSettings, SetLaunchAtLoginInput } from '@deskpulse/contracts';

/**
 * Settings IPC handlers (PDD §16). Thin adapters over the launch-at-login
 * controller; every response reflects the OS truth read back after a write.
 */
export function handleGetSettings(login: LaunchAtLoginController): () => AppSettings {
  return () => ({ launchAtLogin: login.isEnabled() });
}

export function handleSetLaunchAtLogin(
  login: LaunchAtLoginController,
): (input: SetLaunchAtLoginInput) => AppSettings {
  return (input) => ({ launchAtLogin: login.setEnabled(input.enabled) });
}

export const settingsInputSchemas = {
  setLaunchAtLogin: setLaunchAtLoginInputSchema,
};
