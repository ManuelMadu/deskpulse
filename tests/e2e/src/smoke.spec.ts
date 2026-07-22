import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Phase 2 smoke (PDD M1): the packaged app boots with a locked-down
 * renderer, spawns the agent as a real child OS process, and quitting
 * leaves no orphan. Runs against `npm run package` output — packaged
 * behavior, not dev behavior, is what ships (PDD R4).
 */

const OUT_DIR = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'out');

function findAppBinary(): string {
  if (!existsSync(OUT_DIR)) {
    throw new Error(`No packaged app at ${OUT_DIR} — run \`npm run package\` first.`);
  }
  const platformDir = readdirSync(OUT_DIR).find((name) => name.startsWith('DeskPulse-darwin-'));
  if (!platformDir) {
    throw new Error(`No DeskPulse-darwin-* directory in ${OUT_DIR} — run \`npm run package\`.`);
  }
  return join(OUT_DIR, platformDir, 'DeskPulse.app', 'Contents', 'MacOS', 'DeskPulse');
}

function agentProcessPids(): string[] {
  try {
    return execFileSync('/usr/bin/pgrep', ['-f', 'agent.cjs'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

/** Agents spawned since `before` — this test's own, ignoring sibling residue. */
function newAgentPids(before: string[]): string[] {
  return agentProcessPids().filter((pid) => !before.includes(pid));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

test('packaged app boots sandboxed, supervises the agent, and quits without orphans', async () => {
  expect(agentProcessPids(), 'no stray agents before the test').toEqual([]);

  const app = await electron.launch({ executablePath: findAppBinary() });

  try {
    const window = await app.firstWindow();
    await expect(window.locator('h1')).toHaveText('DeskPulse');

    // Renderer lockdown: sandboxed, no Node globals, no Electron internals —
    // and the preload exposes exactly the frozen narrow surface, never ipcRenderer.
    const globals = await window.evaluate(() => ({
      process: typeof (globalThis as Record<string, unknown>)['process'],
      require: typeof (globalThis as Record<string, unknown>)['require'],
      Buffer: typeof (globalThis as Record<string, unknown>)['Buffer'],
      ipcRenderer: typeof (globalThis as Record<string, unknown>)['ipcRenderer'],
      deskPulse: typeof (globalThis as Record<string, unknown>)['deskPulse'],
    }));
    expect(globals).toEqual({
      process: 'undefined',
      require: 'undefined',
      Buffer: 'undefined',
      ipcRenderer: 'undefined',
      deskPulse: 'object',
    });

    // The IPC slice works end to end: the sidebar pill reaches "running"
    // with the real agent pid via preload → Main → supervisor.
    await expect(window.locator('[data-testid="agent-pill"]')).toContainText('Agent running', {
      timeout: 15_000,
    });

    // Live metrics flow the full path: agent sampler → /system → AgentClient
    // → IPC → Dashboard (DP-9); the big numeral shows a real percentage.
    await expect(window.locator('[data-testid="cpu-overall"]')).toContainText('%', {
      timeout: 15_000,
    });

    // Process table flows through the validated-input IPC handler (DP-10).
    await expect(window.locator('[data-testid="process-row"]').first()).toContainText('%', {
      timeout: 15_000,
    });

    // The agent runs as a separate OS process (spawned from Resources/agent.cjs).
    await waitUntil(() => agentProcessPids().length === 1, 15_000, 'agent child process');

    // Menu-bar lifecycle (PDD §13, M4): closing the window HIDES it — the app
    // stays alive with its agent still running — and reactivation reveals the
    // same window. Closing must not tear down the agent.
    const isWindowVisible = (): Promise<boolean> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false);

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect.poll(isWindowVisible, { timeout: 5_000 }).toBe(false);
    // Agent survives a window close (only explicit quit stops it).
    expect(agentProcessPids().length, 'agent still running after window hide').toBe(1);

    // Reactivation (Dock click / tray "Open DeskPulse") reveals the window.
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    await expect.poll(isWindowVisible, { timeout: 5_000 }).toBe(true);

    // Notification click routing (PDD §25): the banner itself can't be
    // automated, but Main's navigate push — the exact effect of a click — can.
    // Sending it must switch the renderer to the Monitors screen.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('deskpulse:navigate', 'monitors'),
    );
    await expect(window.getByRole('button', { name: 'Monitors' })).toHaveAttribute(
      'aria-current',
      'page',
      { timeout: 5_000 },
    );

    // Settings screen (PDD §13): the launch-at-login toggle hydrates from Main
    // over the new settings IPC. Assert it loads (becomes enabled) end to end —
    // deliberately WITHOUT clicking it, which would register a real login item.
    await window.getByRole('button', { name: 'Settings' }).click();
    const loginToggle = window.getByTestId('launch-at-login-toggle');
    await expect(loginToggle).toBeVisible();
    await expect(loginToggle).toBeEnabled({ timeout: 5_000 });

    // Quit through the real quit path (before-quit stops the agent).
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitUntil(() => agentProcessPids().length === 0, 10_000, 'agent teardown on quit');
  } finally {
    // Belt and braces: never leak the app process across test runs.
    await app.close().catch(() => undefined);
  }

  expect(agentProcessPids(), 'no orphan agent after quit').toEqual([]);
});

test('flow 2: opening a log file streams appended lines to the viewer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskpulse-e2e-log-'));
  const logPath = join(dir, 'app.log');
  writeFileSync(logPath, 'pre-existing line\n');
  const preExistingAgents = agentProcessPids();

  const app = await electron.launch({ executablePath: findAppBinary() });
  try {
    const window = await app.firstWindow();
    await expect(window.locator('[data-testid="agent-pill"]')).toContainText('Agent running', {
      timeout: 15_000,
    });

    // The native file dialog can't be automated, so stub it to return our
    // temp file — everything after (token minting, POST /watch, tailing, SSE)
    // is the real path under test.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = () =>
        Promise.resolve({ canceled: false, filePaths: [filePath] } as Awaited<
          ReturnType<typeof dialog.showOpenDialog>
        >);
    }, logPath);

    await window.getByRole('button', { name: 'Logs' }).click();
    await window.getByRole('button', { name: 'Open a log file…' }).click();

    // The viewer appears once the watch starts (fromEnd, so the pre-existing
    // line is intentionally not shown).
    await expect(window.locator('[data-testid="log-view"]')).toBeVisible({ timeout: 15_000 });

    // Let the watch settle at end-of-file before appending, then the new line
    // must appear (PDD AC: ≤ 1 s; generous here for the 1 s stat-poll fallback).
    await window.waitForTimeout(500);
    appendFileSync(logPath, 'streamed-by-flow-2\n');
    await expect(window.locator('[data-testid="log-view"]')).toContainText('streamed-by-flow-2', {
      timeout: 8_000,
    });

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitUntil(
      () => newAgentPids(preExistingAgents).length === 0,
      10_000,
      'agent teardown on quit',
    );
  } finally {
    await app.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }

  expect(newAgentPids(preExistingAgents), 'no orphan agent after flow 2').toEqual([]);
});

test('flow 3: a monitor goes unhealthy when its service fails and recovers when it returns', async () => {
  // A mode-switchable fixture on loopback stands in for a local service.
  let healthy = true;
  const fixture: Server = createServer((_req, res) => {
    res.writeHead(healthy ? 200 : 503).end(healthy ? 'ok' : 'down');
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = (fixture.address() as AddressInfo).port;
  const preExistingAgents = agentProcessPids();

  const app = await electron.launch({ executablePath: findAppBinary() });
  try {
    const window = await app.firstWindow();
    await expect(window.locator('[data-testid="agent-pill"]')).toContainText('Agent running', {
      timeout: 15_000,
    });

    await window.getByRole('button', { name: 'Monitors' }).click();
    await window.getByRole('button', { name: 'Add monitor' }).click();

    // Fast thresholds so the transitions happen inside the test budget.
    await window.getByTestId('monitor-name').fill('fixture');
    await window.getByTestId('monitor-url').fill(`http://127.0.0.1:${fixturePort}/health`);
    await window.getByTestId('monitor-interval').fill('5');
    await window.getByTestId('monitor-failures').fill('1');
    // The header and the sheet both have an "Add monitor" button; submit the sheet's.
    await window.locator('.sheet').getByRole('button', { name: 'Add monitor' }).click();

    const chip = window.locator('[data-testid="monitor-row"] .status-chip');
    await expect(chip).toContainText('Healthy', { timeout: 20_000 });

    healthy = false;
    await expect(chip).toContainText('Unhealthy', { timeout: 20_000 });

    healthy = true;
    await expect(chip).toContainText('Healthy', { timeout: 20_000 });

    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitUntil(
      () => newAgentPids(preExistingAgents).length === 0,
      10_000,
      'agent teardown on quit',
    );
  } finally {
    await app.close().catch(() => undefined);
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }

  expect(newAgentPids(preExistingAgents), 'no orphan agent after flow 3').toEqual([]);
});
