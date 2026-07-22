/**
 * Launch-at-login control (PDD §13/§29). The OS is the source of truth: every
 * write is followed by a read-back, so the settings screen never shows a value
 * the system didn't actually accept. Hidden launch is requested so a login
 * start comes up menu-bar-only (openAsHidden), matching the lifecycle contract.
 *
 * The Electron `app.getLoginItemSettings` / `setLoginItemSettings` calls are
 * injected as a gateway so the read-back logic is unit-tested without Electron.
 */

export interface LoginItemState {
  openAtLogin: boolean;
  openAsHidden: boolean;
  wasOpenedAsHidden: boolean;
}

export interface LoginItemGateway {
  get: () => LoginItemState;
  set: (settings: { openAtLogin: boolean; openAsHidden: boolean }) => void;
}

export class LaunchAtLoginController {
  constructor(private readonly gateway: LoginItemGateway) {}

  /** Current OS truth for whether DeskPulse opens at login. */
  isEnabled(): boolean {
    return this.gateway.get().openAtLogin;
  }

  /** Apply the toggle, then report back what the OS actually stored. */
  setEnabled(enabled: boolean): boolean {
    this.gateway.set({ openAtLogin: enabled, openAsHidden: true });
    return this.gateway.get().openAtLogin;
  }
}
