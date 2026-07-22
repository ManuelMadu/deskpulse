import path from 'node:path';

import { BrowserWindow } from 'electron';

import { WINDOW_DEFAULTS } from './config.js';

/**
 * Main window lifecycle (PDD §16 windows.ts). One BrowserWindow, created
 * hidden and shown on `ready-to-show`. Closing the window HIDES it rather than
 * destroying it (PDD §13): the app stays resident in the menu bar and the
 * renderer keeps its state, so reopening is instant. Only an explicit Quit
 * (which flips `isQuitting`) is allowed to actually close the window.
 */

export interface WindowFactoryOptions {
  /** Vite dev-server URL in `npm start`; undefined for the packaged build. */
  devServerUrl: string | undefined;
  /** Built renderer entry name (MAIN_WINDOW_VITE_NAME) for the file load path. */
  rendererName: string;
  /** True once an explicit quit is underway — lets the window really close. */
  isQuitting: () => boolean;
}

let mainWindow: BrowserWindow | undefined;

/** The live main window, or undefined if none exists / it was destroyed. */
export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

export function createMainWindow(
  options: WindowFactoryOptions,
  /** Launched as a hidden login item (PDD §13): build the window but stay in
   * the menu bar only, ready to reveal on activate / tray "Open DeskPulse". */
  startHidden = false,
): BrowserWindow {
  const window = new BrowserWindow({
    ...WINDOW_DEFAULTS,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow = window;

  if (!startHidden) {
    window.once('ready-to-show', () => window.show());
  }

  // Hide-on-close (PDD §13): the red button / ⌘W tucks the window away instead
  // of tearing it down. `window-all-closed` deliberately does not quit, so the
  // agent and monitors keep running behind the menu bar.
  window.on('close', (event) => {
    if (!options.isQuitting()) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${options.rendererName}/index.html`));
  }
  return window;
}

/**
 * Bring the window to the user (tray "Open DeskPulse" / Dock activate, PDD §13):
 * restore if minimized, un-hide, and focus. Recreates the window if it was
 * destroyed (e.g. a non-darwin quit path left none).
 */
export function revealMainWindow(options: WindowFactoryOptions): BrowserWindow {
  const existing = getMainWindow();
  if (!existing) {
    return createMainWindow(options);
  }
  if (existing.isMinimized()) {
    existing.restore();
  }
  existing.show();
  existing.focus();
  return existing;
}
