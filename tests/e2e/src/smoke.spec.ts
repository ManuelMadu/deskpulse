import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

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

    // Renderer lockdown: sandboxed, no Node globals, no Electron internals.
    const globals = await window.evaluate(() => ({
      process: typeof (globalThis as Record<string, unknown>)['process'],
      require: typeof (globalThis as Record<string, unknown>)['require'],
      Buffer: typeof (globalThis as Record<string, unknown>)['Buffer'],
    }));
    expect(globals).toEqual({ process: 'undefined', require: 'undefined', Buffer: 'undefined' });

    // The agent runs as a separate OS process (spawned from Resources/agent.cjs).
    await waitUntil(() => agentProcessPids().length === 1, 15_000, 'agent child process');

    // Quit through the real quit path (before-quit stops the agent).
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await waitUntil(() => agentProcessPids().length === 0, 10_000, 'agent teardown on quit');
  } finally {
    // Belt and braces: never leak the app process across test runs.
    await app.close().catch(() => undefined);
  }

  expect(agentProcessPids(), 'no orphan agent after quit').toEqual([]);
});
