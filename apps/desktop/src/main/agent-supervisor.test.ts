import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AgentStartError,
  AgentSupervisor,
  killProcessGracefully,
  parseHandshakeLine,
} from './agent-supervisor.js';

const execFileAsync = promisify(execFile);
const AGENT_WORKSPACE = join(__dirname, '..', '..', '..', '..', 'services', 'system-agent');
const BUNDLE = join(AGENT_WORKSPACE, 'dist', 'agent.cjs');

const noopLog = (): void => {};
let logDir: string;

beforeAll(async () => {
  await execFileAsync(process.execPath, ['esbuild.config.mjs'], { cwd: AGENT_WORKSPACE });
  logDir = mkdtempSync(join(tmpdir(), 'deskpulse-supervisor-'));
}, 60_000);

afterAll(() => {
  rmSync(logDir, { recursive: true, force: true });
});

function makeSupervisor(overrides: Partial<ConstructorParameters<typeof AgentSupervisor>[0]> = {}) {
  return new AgentSupervisor({
    bundlePath: BUNDLE,
    execPath: process.execPath,
    env: { DESKPULSE_AGENT_LOG_DIR: logDir },
    log: noopLog,
    ...overrides,
  });
}

describe('parseHandshakeLine', () => {
  it('parses a valid handshake line', () => {
    const line = '{"type":"deskpulse-agent-ready","port":50123,"pid":42,"version":"0.1.0"}';
    expect(parseHandshakeLine(line)).toEqual({
      type: 'deskpulse-agent-ready',
      port: 50123,
      pid: 42,
      version: '0.1.0',
    });
  });

  it('returns null for garbage, non-JSON, and non-handshake JSON', () => {
    expect(parseHandshakeLine('starting up...')).toBeNull();
    expect(parseHandshakeLine('{broken')).toBeNull();
    expect(parseHandshakeLine('{"type":"something-else"}')).toBeNull();
    expect(
      parseHandshakeLine('{"type":"deskpulse-agent-ready","port":0,"pid":42,"version":"x"}'),
    ).toBeNull();
    expect(parseHandshakeLine('')).toBeNull();
  });
});

describe('AgentSupervisor happy path (DP-7)', () => {
  it('spawns the real bundle, confirms health, and stops it cleanly', async () => {
    const supervisor = makeSupervisor();
    expect(supervisor.state).toBe('idle');

    const handle = await supervisor.start();
    expect(supervisor.state).toBe('running');
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.token).toHaveLength(64);

    // The token actually gates the API of this exact process.
    const unauthorized = await fetch(`http://127.0.0.1:${handle.port}/health`);
    expect(unauthorized.status).toBe(401);
    const authorized = await fetch(`http://127.0.0.1:${handle.port}/health`, {
      headers: { authorization: `Bearer ${handle.token}` },
    });
    expect(authorized.status).toBe(200);
    const health = (await authorized.json()) as { pid: number };
    expect(health.pid).toBe(handle.pid);

    await supervisor.stop();
    expect(supervisor.state).toBe('stopped');

    await expect(
      fetch(`http://127.0.0.1:${handle.port}/health`, {
        headers: { authorization: `Bearer ${handle.token}` },
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow();
  }, 20_000);

  it('generates a fresh token per spawn', async () => {
    const supervisor = makeSupervisor();
    const first = await supervisor.start();
    await supervisor.stop();
    const second = await supervisor.start();
    await supervisor.stop();
    expect(first.token).not.toBe(second.token);
  }, 30_000);

  it('classifies a missing bundle as spawn-error/early-exit', async () => {
    const supervisor = makeSupervisor({ bundlePath: '/nonexistent/agent.cjs' });
    const error = await supervisor.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentStartError);
    // node exits non-zero for a missing script (early-exit); a missing
    // exec binary would surface as spawn-error. Both are failed starts.
    expect(['spawn-error', 'early-exit']).toContain((error as AgentStartError).kind);
    expect(supervisor.state).toBe('stopped');
  });

  it('times out when the child never prints a handshake', async () => {
    const silentScript = join(logDir, 'silent.cjs');
    writeFileSync(silentScript, 'setInterval(() => {}, 1000);');
    const supervisor = makeSupervisor({
      bundlePath: silentScript,
      handshakeDeadlineMs: 1_000,
    });
    const error = await supervisor.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentStartError);
    expect((error as AgentStartError).kind).toBe('handshake-timeout');
    expect(supervisor.state).toBe('stopped');
  }, 10_000);
});

describe('killProcessGracefully', () => {
  it('SIGKILLs a child that ignores SIGTERM', async () => {
    const stubborn = spawn(process.execPath, [
      '-e',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    ]);
    await new Promise((resolve) => stubborn.once('spawn', resolve));
    // Give the child a moment to install its SIGTERM handler.
    await vi.waitFor(() => expect(stubborn.pid).toBeDefined());
    await new Promise((r) => setTimeout(r, 300));

    const outcome = await killProcessGracefully(stubborn, 500);
    expect(outcome).toBe('killed');
    expect(stubborn.signalCode).toBe('SIGKILL');
  }, 10_000);

  it('reports exited for a child that honors SIGTERM', async () => {
    const polite = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    await new Promise((resolve) => polite.once('spawn', resolve));
    const outcome = await killProcessGracefully(polite, 2_000);
    expect(outcome).toBe('exited');
  }, 10_000);
});
