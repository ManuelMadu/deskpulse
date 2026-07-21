import { ERROR_CODES, errorEnvelopeSchema, monitorWithStatusSchema } from '@deskpulse/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startAgent } from '../src/agent.js';

import type { AgentInstance } from '../src/agent.js';

const TOKEN = 'monitors-endpoint-test-token-0123456789';

describe('monitor CRUD endpoints (DP P5-c)', () => {
  let agent: AgentInstance;
  let base: string;
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

  beforeAll(async () => {
    agent = await startAgent({
      token: TOKEN,
      metricsIntervalMs: 60_000,
      health: { jitterMs: 0, intervalMsOverride: 100_000 }, // don't actually probe here
    });
    base = `http://127.0.0.1:${agent.port}`;
  });

  afterEach(() => {
    agent.monitors.closeAll();
  });

  afterAll(async () => {
    await agent.close();
  });

  const validConfig = {
    name: 'API',
    url: 'http://127.0.0.1:3000/healthz',
    method: 'GET',
    intervalSeconds: 30,
    timeoutMs: 5000,
    expectedStatus: { min: 200, max: 399 },
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: false,
  };

  function post(body: unknown): Promise<Response> {
    return fetch(`${base}/monitors`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  }

  it('creates, lists, patches, and deletes a monitor', async () => {
    const created = monitorWithStatusSchema.parse(await (await post(validConfig)).json());
    expect(created.state).toBe('unknown');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = z
      .array(monitorWithStatusSchema)
      .parse(await (await fetch(`${base}/monitors`, { headers: auth })).json());
    expect(list).toHaveLength(1);

    const patched = monitorWithStatusSchema.parse(
      await (
        await fetch(`${base}/monitors/${created.id}`, {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ name: 'Renamed', intervalSeconds: 60 }),
        })
      ).json(),
    );
    expect(patched.name).toBe('Renamed');
    expect(patched.intervalSeconds).toBe(60);

    const del = await fetch(`${base}/monitors/${created.id}`, { method: 'DELETE', headers: auth });
    expect(del.status).toBe(204);
    expect(agent.monitors.activeCount).toBe(0);
  });

  it('rejects a non-loopback url with 400 VALIDATION_FAILED', async () => {
    const res = await post({ ...validConfig, url: 'http://example.com' });
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('404s a patch/delete on an unknown id', async () => {
    const unknown = '018f4e2a-0000-7000-8000-000000000000';
    const patch = await fetch(`${base}/monitors/${unknown}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ name: 'x' }),
    });
    expect(patch.status).toBe(404);
    const del = await fetch(`${base}/monitors/${unknown}`, { method: 'DELETE', headers: auth });
    expect(del.status).toBe(404);
  });

  it('resets state to unknown when url changes via PATCH', async () => {
    const created = monitorWithStatusSchema.parse(await (await post(validConfig)).json());
    const patched = monitorWithStatusSchema.parse(
      await (
        await fetch(`${base}/monitors/${created.id}`, {
          method: 'PATCH',
          headers: auth,
          body: JSON.stringify({ url: 'http://localhost:9999/new' }),
        })
      ).json(),
    );
    expect(patched.state).toBe('unknown');
    expect(patched.url).toBe('http://localhost:9999/new');
  });

  it('enforces the 20-monitor limit with 409', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await post({ ...validConfig, name: `m${i}` })).status).toBe(201);
    }
    const over = await post({ ...validConfig, name: 'over' });
    expect(over.status).toBe(409);
    expect(errorEnvelopeSchema.parse(await over.json()).error.code).toBe(ERROR_CODES.LIMIT_REACHED);
  });

  it('requires auth', async () => {
    const res = await fetch(`${base}/monitors`);
    expect(res.status).toBe(401);
  });
});
