import path from 'node:path';

import { BrowserWindow, app } from 'electron';

import { WINDOW_DEFAULTS } from './config.js';

// Security posture (PDD §30) is set here from day one and never relaxed:
// sandboxed renderer, context isolation, no Node integration, all navigation
// and window creation denied except the app's own document.

function createWindow(): BrowserWindow {
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

  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return window;
}

app.on('web-contents-created', (_event, contents) => {
  // The renderer never opens windows and never navigates away from the app.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    const appOrigin = MAIN_WINDOW_VITE_DEV_SERVER_URL ?? 'file://';
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
    }
  });
});

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // macOS convention — and required here: monitoring continues in the menu
  // bar (PDD §13). Non-darwin quits; the platform adapter revisits this in
  // Phase W. Full hide-on-close lifecycle lands in Phase 6.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
