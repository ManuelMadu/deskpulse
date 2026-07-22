import { app } from 'electron';

import { AgentClient } from './agent-client.js';
import { AgentEventConsumer } from './agent-events.js';
import { resolveAgentBundlePath } from './agent-paths.js';
import { installAppLifecycle, launchInitialWindow } from './app-lifecycle.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { forwardAgentEvent } from './event-bridge.js';
import { registerIpcHandlers } from './ipc/register.js';
import { defaultLogLocations } from './log-locations.js';
import { PathTokenRegistry } from './path-tokens.js';

import type { WindowFactoryOptions } from './windows.js';

// Security posture (PDD §30) is set here from day one and never relaxed:
// sandboxed renderer, context isolation, no Node integration, all navigation
// and window creation denied except the app's own document.

let supervisor: AgentSupervisor | undefined;
let eventConsumer: AgentEventConsumer | undefined;
let isQuitting = false;

const windowOptions: WindowFactoryOptions = {
  devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
  rendererName: MAIN_WINDOW_VITE_NAME,
  isQuitting: () => isQuitting,
};

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
  const endpoint = () => {
    const handle = activeSupervisor.currentHandle;
    return handle ? { port: handle.port, token: handle.token } : undefined;
  };
  const client = new AgentClient(endpoint);
  const tokens = new PathTokenRegistry();

  // Consume the agent's SSE stream once in Main and fan events to renderers.
  eventConsumer = new AgentEventConsumer(endpoint, forwardAgentEvent, (level, msg, ctx) =>
    console[level === 'error' ? 'error' : 'log'](`[events] ${msg}`, ctx ?? ''),
  );
  eventConsumer.start();

  registerIpcHandlers({
    supervisor,
    client,
    tokens,
    defaultLogLocations: defaultLogLocations(),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined,
  });

  installAppLifecycle({
    windowOptions,
    hasRunningServices: () => !!supervisor && supervisor.state !== 'stopped',
    stopServices: async () => {
      eventConsumer?.stop();
      await supervisor?.stop();
    },
    isQuitting: () => isQuitting,
    setQuitting: (value) => {
      isQuitting = value;
    },
    onResume: () => {
      // Wake from sleep: drop the possibly-dead SSE socket so the consumer
      // reconnects immediately (its staleness timer might not fire for ~45 s).
      // The renderer re-polls /system on its own 2 s timer once visible.
      eventConsumer?.stop();
      eventConsumer?.start();
    },
    log: (level, msg, ctx) =>
      console[level === 'error' ? 'error' : 'log'](`[lifecycle] ${msg}`, ctx ?? ''),
  });

  launchInitialWindow(windowOptions);
});
