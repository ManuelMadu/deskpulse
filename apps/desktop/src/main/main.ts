import path from 'node:path';

import { BrowserWindow, app } from 'electron';

import { AgentClient } from './agent-client.js';
import { resolveAgentBundlePath } from './agent-paths.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { WINDOW_DEFAULTS } from './config.js';
import { registerIpcHandlers } from './ipc/register.js';

// Security posture (PDD §30) is set here from day one and never relaxed:
// sandboxed renderer, context isolation, no Node integration, all navigation
// and window creation denied except the app's own document.

let supervisor: AgentSupervisor | undefined;
let isQuitting = false;

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
  supervisor = new AgentSupervisor({
    bundlePath: resolveAgentBundlePath(),
    execPath: process.execPath,
    log: (level, msg, ctx) => {
      // Pino-backed main logging arrives in Phase 2's logging ticket; until
      // then supervisor events go to the terminal in dev.
      console[level === 'error' ? 'error' : 'log'](`[supervisor] ${msg}`, ctx ?? '');
    },
  });

  supervisor.start().catch((error: unknown) => {
    // Happy-path ticket: a failed start is logged and surfaced via
    // getAgentStatus; restart/backoff behavior is Phase 7 (PDD §28).
    console.error('[supervisor] agent failed to start', error);
  });

  const activeSupervisor = supervisor;
  const client = new AgentClient(() => {
    const handle = activeSupervisor.currentHandle;
    return handle ? { port: handle.port, token: handle.token } : undefined;
  });

  registerIpcHandlers({
    supervisor,
    client,
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  // Quit orchestration (PDD §13/FR-17): stop the agent before exiting so a
  // packaged quit never leaves an orphan. preventDefault once, stop, re-quit.
  if (isQuitting || !supervisor || supervisor.state === 'stopped') {
    return;
  }
  event.preventDefault();
  isQuitting = true;
  void supervisor
    .stop()
    .catch((error: unknown) => console.error('[supervisor] stop failed', error))
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // macOS convention — and required here: monitoring continues in the menu
  // bar (PDD §13). Non-darwin quits; the platform adapter revisits this in
  // Phase W. Full hide-on-close lifecycle lands in Phase 6.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
