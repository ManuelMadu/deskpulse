import { app } from 'electron';

import type { LoginItemGateway } from './launch-at-login.js';

/**
 * Electron-backed login-item gateway (PDD §29). Isolated here so the rest of
 * the platform logic stays Electron-free and unit-testable. macOS-first: the
 * login item is registered against the current app bundle; Windows support
 * arrives as an additional adapter later (PDD §42).
 */
export const electronLoginItemGateway: LoginItemGateway = {
  get: () => {
    const settings = app.getLoginItemSettings();
    return {
      openAtLogin: settings.openAtLogin,
      openAsHidden: settings.openAsHidden,
      wasOpenedAsHidden: settings.wasOpenedAsHidden,
    };
  },
  set: (settings) => app.setLoginItemSettings(settings),
};
