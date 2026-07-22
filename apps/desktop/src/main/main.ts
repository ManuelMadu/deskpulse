import { Notification, app } from 'electron';

import { AgentClient } from './agent-client.js';
import { AgentEventConsumer } from './agent-events.js';
import { resolveAgentBundlePath } from './agent-paths.js';
import { installAppLifecycle, launchInitialWindow, openMainWindow } from './app-lifecycle.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { forwardAgentEvent } from './event-bridge.js';
import { HealthState } from './health-state.js';
import { handleListMonitors } from './ipc/monitors.js';
import { registerIpcHandlers } from './ipc/register.js';
import { defaultLogLocations } from './log-locations.js';
import { MonitorNotifier } from './notifications.js';
import { PathTokenRegistry } from './path-tokens.js';
import { TrayController } from './tray.js';
import { getMainWindow } from './windows.js';

import { IPC_CHANNELS, monitorWithStatusSchema } from '@deskpulse/contracts';

import type { Presenter } from './notifications.js';
import type { WindowFactoryOptions } from './windows.js';
import type { AgentEvent } from '@deskpulse/contracts';

/**
 * Present a native banner (PDD §13/§25). On unsigned dev builds macOS
 * attributes these to "Electron" and may require enabling notifications in
 * System Settings — documented in the README; signed builds attribute
 * correctly.
 */
const electronPresenter: Presenter = ({ title, body }) => {
  if (!Notification.isSupported()) {
    return { onClick: () => undefined };
  }
  const notification = new Notification({ title, body });
  notification.show();
  return { onClick: (handler) => notification.on('click', handler) };
};

// Security posture (PDD §30) is set here from day one and never relaxed:
// sandboxed renderer, context isolation, no Node integration, all navigation
// and window creation denied except the app's own document.

const HYDRATE_INTERVAL_MS = 30_000;

let supervisor: AgentSupervisor | undefined;
let eventConsumer: AgentEventConsumer | undefined;
let tray: TrayController | undefined;
let notifier: MonitorNotifier | undefined;
let hydrateTimer: ReturnType<typeof setInterval> | undefined;
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

  const activeSupervisor = supervisor;
  const endpoint = () => {
    const handle = activeSupervisor.currentHandle;
    return handle ? { port: handle.port, token: handle.token } : undefined;
  };
  const client = new AgentClient(endpoint);
  const tokens = new PathTokenRegistry();
  const listMonitors = handleListMonitors(client);

  // Aggregate health, distilled from the same event stream the renderer sees,
  // drives the tray icon and (Phase 6c) notifications.
  const health = new HealthState();

  const refreshTray = (): void => tray?.update(health.snapshot());
  const hydrateTray = async (): Promise<void> => {
    try {
      if (health.hydrateMonitors(await listMonitors())) {
        refreshTray();
      }
    } catch {
      // Agent unavailable — keep the last known snapshot rather than blanking.
    }
  };
  const pauseAllMonitors = async (): Promise<void> => {
    try {
      const monitors = await listMonitors();
      await Promise.all(
        monitors
          .filter((monitor) => monitor.enabled)
          .map((monitor) =>
            client.patch(`/monitors/${monitor.id}`, { enabled: false }, monitorWithStatusSchema),
          ),
      );
      await hydrateTray();
    } catch (error) {
      console.error('[tray] pause all monitors failed', error);
    }
  };

  // Raise the window and jump to the Monitors screen (notification click).
  const navigateToMonitors = (): void => {
    openMainWindow(windowOptions);
    const window = getMainWindow();
    if (!window) {
      return;
    }
    const send = (): void => window.webContents.send(IPC_CHANNELS.navigate, 'monitors');
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  };

  // Create the tray immediately (PDD §13: fast feedback), agent-down until the
  // supervisor confirms a live agent.
  tray = new TrayController({
    onOpen: () => openMainWindow(windowOptions),
    onPauseAll: () => void pauseAllMonitors(),
    onQuit: () => app.quit(),
  });
  tray.create(health.snapshot());

  // Native monitor notifications, driven from Main (PDD §25): transition-only,
  // bursts coalesced, clicks routed to Monitors.
  notifier = new MonitorNotifier({
    present: electronPresenter,
    onActivate: navigateToMonitors,
  });

  // Consume the agent's SSE stream once in Main: forward to renderers AND fold
  // into the aggregate health that paints the tray and fires notifications.
  const onAgentEvent = (event: AgentEvent): void => {
    forwardAgentEvent(event);
    notifier?.handleEvent(event);
    if (health.ingest(event)) {
      refreshTray();
    }
  };
  eventConsumer = new AgentEventConsumer(endpoint, onAgentEvent, (level, msg, ctx) =>
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
      if (hydrateTimer) {
        clearInterval(hydrateTimer);
        hydrateTimer = undefined;
      }
      eventConsumer?.stop();
      notifier?.dispose();
      notifier = undefined;
      await supervisor?.stop();
      tray?.destroy();
      tray = undefined;
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
      void hydrateTray();
    },
    log: (level, msg, ctx) =>
      console[level === 'error' ? 'error' : 'log'](`[lifecycle] ${msg}`, ctx ?? ''),
  });

  launchInitialWindow(windowOptions);

  supervisor
    .start()
    .then(() => {
      // The agent is alive: reflect it in the tray and seed the monitor list.
      if (health.setAgentUp(true)) {
        refreshTray();
      }
      void hydrateTray();
    })
    .catch((error: unknown) => {
      // Happy-path ticket: a failed start is logged and surfaced via
      // getAgentStatus; restart/backoff behavior is Phase 7 (PDD §28).
      console.error('[supervisor] agent failed to start', error);
      if (health.setAgentUp(false)) {
        refreshTray();
      }
    });

  // Periodically reconcile the tray's monitor list so removed/renamed monitors
  // and states settle even without a transition event.
  hydrateTimer = setInterval(() => void hydrateTray(), HYDRATE_INTERVAL_MS);
  hydrateTimer.unref();
});
