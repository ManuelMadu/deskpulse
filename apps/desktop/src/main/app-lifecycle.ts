import { app, powerMonitor } from 'electron';

import { createMainWindow, revealMainWindow } from './windows.js';

import type { WindowFactoryOptions } from './windows.js';

/**
 * macOS application lifecycle wiring (PDD §13/§16). Turns DeskPulse into a
 * resident menu-bar app: closing the window hides it (see windows.ts), the app
 * survives `window-all-closed`, Dock/tray reopen reveals the same window, and
 * an explicit Quit tears the agent down cleanly before exit.
 */

type Logger = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx?: Record<string, unknown>,
) => void;

export interface AppLifecycleDeps {
  windowOptions: WindowFactoryOptions;
  /** Stop SSE consumption and the agent; resolves once teardown is done. */
  stopServices: () => Promise<void>;
  /** True while there is still something worth stopping before quit. */
  hasRunningServices: () => boolean;
  /** Flip the quit flag so the window's close handler stops intercepting. */
  setQuitting: (value: boolean) => void;
  isQuitting: () => boolean;
  /** Wake-from-sleep hook: force a fresh health/metrics cycle (PDD §13). */
  onResume?: () => void;
  log: Logger;
}

/** Reveal (or recreate) the main window — shared by activate + tray + relaunch. */
export function openMainWindow(options: WindowFactoryOptions): void {
  revealMainWindow(options);
}

/** Create the launch window, honoring a hidden login-item start (PDD §13). */
export function launchInitialWindow(options: WindowFactoryOptions): void {
  const openedAsHidden = app.getLoginItemSettings().wasOpenedAsHidden;
  createMainWindow(options, openedAsHidden);
}

export function installAppLifecycle(deps: AppLifecycleDeps): void {
  const { windowOptions } = deps;

  // Dock click / app reactivation → bring the existing window forward, or
  // recreate it if it was destroyed.
  app.on('activate', () => {
    revealMainWindow(windowOptions);
  });

  // macOS convention, and required here: monitoring continues in the menu bar,
  // so closing every window must NOT quit (PDD §13). Non-darwin has no tray
  // story yet, so it still quits (the platform adapter revisits this later).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Explicit Quit orchestration (PDD §13/FR-17): stop the agent before exiting
  // so a quit never leaves an orphan child. preventDefault once, tear down,
  // then re-issue the quit.
  app.on('before-quit', (event) => {
    if (deps.isQuitting() || !deps.hasRunningServices()) {
      return;
    }
    event.preventDefault();
    deps.setQuitting(true);
    void deps
      .stopServices()
      .catch((error: unknown) =>
        deps.log('error', 'service teardown failed', { error: String(error) }),
      )
      .finally(() => app.quit());
  });

  // Sleep/wake: a resumed machine may have stale samples and dropped sockets.
  // Force a refresh and let the SSE consumer's staleness check reconnect.
  powerMonitor.on('resume', () => {
    deps.log('info', 'system resumed from sleep; refreshing');
    deps.onResume?.();
  });
}
