import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AGENT_EXIT_CODES, agentReadyHandshakeSchema } from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFile);
const WORKSPACE = join(__dirname, '..');
const BUNDLE = join(WORKSPACE, 'dist', 'agent.cjs');
const TOKEN = 'lifecycle-test-token-0123456789abcdef';

let logDir: string;

function spawnAgent(env: Record<string, string | undefined>): ChildProcess {
  return spawn(process.execPath, [BUNDLE], {
    env: { PATH: process.env['PATH'], ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHandshake(child: ChildProcess, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`no handshake within ${timeoutMs}ms; got: ${buffer}`)),
      timeoutMs,
    );
    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(buffer.slice(0, newline)));
        } catch (error) {
          reject(new Error(`handshake line is not JSON: ${String(error)}`));
        }
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`agent exited early with code ${String(code)}`));
    });
  });
}

beforeAll(async () => {
  // Test the real artifact: bundle exactly as packaging does.
  await execFileAsync(process.execPath, ['esbuild.config.mjs'], { cwd: WORKSPACE });
  logDir = mkdtempSync(join(tmpdir(), 'deskpulse-agent-logs-'));
}, 60_000);

afterAll(() => {
  rmSync(logDir, { recursive: true, force: true });
});

describe('agent lifecycle (DP-6)', () => {
  it('exits 78 (EX_CONFIG) when spawned without a token', async () => {
    const child = spawnAgent({ DESKPULSE_AGENT_LOG_DIR: logDir });
    const { code } = await waitForExit(child);
    expect(code).toBe(AGENT_EXIT_CODES.noToken);
  });

  it('prints a schema-valid ready handshake, serves authed /health, and SIGTERM-exits 0 within 3 s', async () => {
    const child = spawnAgent({
      DESKPULSE_AGENT_TOKEN: TOKEN,
      DESKPULSE_AGENT_LOG_DIR: logDir,
    });

    const handshake = agentReadyHandshakeSchema.parse(await waitForHandshake(child));
    expect(handshake.pid).toBe(child.pid);

    const health = await fetch(`http://127.0.0.1:${handshake.port}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(health.status).toBe(200);

    const started = Date.now();
    child.kill('SIGTERM');
    const { code, signal } = await waitForExit(child);
    const elapsed = Date.now() - started;

    expect(signal).toBeNull(); // exited by itself, not killed
    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(3_000);

    // The port must actually be released.
    await expect(
      fetch(`http://127.0.0.1:${handshake.port}/health`, {
        headers: { authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(1_000),
      }),
    ).rejects.toThrow();
  });

  it('writes structured JSON logs to the configured directory and never logs the token', async () => {
    const child = spawnAgent({
      DESKPULSE_AGENT_TOKEN: TOKEN,
      DESKPULSE_AGENT_LOG_DIR: logDir,
    });
    await waitForHandshake(child);
    child.kill('SIGTERM');
    await waitForExit(child);

    const logFile = join(logDir, 'agent.log');
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, 'utf8');
    expect(content).toContain('"msg":"agent ready"');
    expect(content).toContain('"msg":"shutdown complete"');
    expect(content).toContain('"proc":"agent"');
    expect(content.includes(TOKEN)).toBe(false);

    for (const line of content.trim().split('\n')) {
      expect(() => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });
});
