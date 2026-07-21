import { ERROR_CODES, errorEnvelopeSchema, processesResponseSchema } from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAgent } from '../src/agent.js';

import type { AgentServer } from '../src/http/server.js';

const TOKEN = 'processes-endpoint-test-token-0123456789';

describe('GET /processes (DP-10)', () => {
  let agent: AgentServer;
  let base: string;
  const headers = { authorization: `Bearer ${TOKEN}` };

  beforeAll(async () => {
    agent = await startAgent({ token: TOKEN, metricsIntervalMs: 60_000 });
    base = `http://127.0.0.1:${agent.port}`;
  });

  afterAll(async () => {
    await agent.close();
  });

  it('serves a contract-valid top-process list from the real /bin/ps', async () => {
    const res = await fetch(`${base}/processes`, { headers });
    expect(res.status).toBe(200);
    const parsed = processesResponseSchema.parse(await res.json());
    expect(parsed.processes.length).toBeGreaterThan(0);
    expect(parsed.processes.length).toBeLessThanOrEqual(20); // default limit
    // launchd (pid 1) exists on every macOS system; our own pid is running too.
    expect(parsed.processes.every((p) => p.pid > 0)).toBe(true);
  });

  it('honors limit and sortBy', async () => {
    const res = await fetch(`${base}/processes?limit=3&sortBy=memory`, { headers });
    expect(res.status).toBe(200);
    const parsed = processesResponseSchema.parse(await res.json());
    expect(parsed.processes.length).toBeLessThanOrEqual(3);
    const rss = parsed.processes.map((p) => p.memoryRssBytes);
    expect([...rss].sort((a, b) => b - a)).toEqual(rss);
  });

  it('rejects the full invalid-query matrix with VALIDATION_FAILED', async () => {
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'limit=2.5',
      'sortBy=disk',
      'nope=1',
    ]) {
      const res = await fetch(`${base}/processes?${query}`, { headers });
      expect(res.status, query).toBe(400);
      const envelope = errorEnvelopeSchema.parse(await res.json());
      expect(envelope.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(envelope.error.details?.['issues']).toBeDefined();
    }
  });

  it('requires auth like every other route', async () => {
    const res = await fetch(`${base}/processes`);
    expect(res.status).toBe(401);
  });
});
