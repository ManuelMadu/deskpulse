import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startAgent } from '../../agent.js';

import type { AgentInstance } from '../../agent.js';

const TOKEN = 'test-token-diagnostics';
let agent: AgentInstance;
let logDir: string;

beforeEach(async () => {
  logDir = mkdtempSync(join(tmpdir(), 'deskpulse-diag-agent-'));
  writeFileSync(join(logDir, 'agent.log'), 'Authorization: Bearer secret\nplain\n');
  agent = await startAgent({ token: TOKEN, logFilePath: join(logDir, 'agent.log') });
});

afterEach(async () => {
  await agent.close();
  rmSync(logDir, { recursive: true, force: true });
});

function post(body: unknown, token: string = TOKEN): Promise<Response> {
  return fetch(`http://127.0.0.1:${agent.port}/diagnostics/export`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /diagnostics/export', () => {
  it('starts an export and returns 202 with an id and staging path', async () => {
    const res = await post({});
    expect(res.status).toBe(202);
    const json = (await res.json()) as { exportId: string; stagingPath: string };
    expect(json.exportId).toMatch(/[0-9a-f-]{36}/);
    expect(json.stagingPath).toContain('bundle.zip');
  });

  it('requires authentication', async () => {
    expect((await post({}, 'wrong-token')).status).toBe(401);
  });

  it('rejects an invalid request body with 400', async () => {
    const res = await post({ extraLogPaths: 'not-an-array' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });
});
