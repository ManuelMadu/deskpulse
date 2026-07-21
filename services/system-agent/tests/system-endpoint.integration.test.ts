import { ERROR_CODES, errorEnvelopeSchema, systemSummarySchema } from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAgent } from '../src/agent.js';

import type { AgentServer } from '../src/http/server.js';

const TOKEN = 'system-endpoint-test-token-0123456789ab';

describe('GET /system (DP-9)', () => {
  let agent: AgentServer;
  let base: string;

  beforeAll(async () => {
    // Short interval so the ready transition happens quickly; the route
    // contract is identical at the production 2 s cadence.
    agent = await startAgent({ token: TOKEN, metricsIntervalMs: 100 });
    base = `http://127.0.0.1:${agent.port}`;
  });

  afterAll(async () => {
    await agent.close();
  });

  it('answers 503 NOT_READY (retryable) before the first sample, then 200 with a contract-valid summary', async () => {
    const headers = { authorization: `Bearer ${TOKEN}` };

    const early = await fetch(`${base}/system`, { headers });
    if (early.status === 503) {
      const envelope = errorEnvelopeSchema.parse(await early.json());
      expect(envelope.error.code).toBe(ERROR_CODES.NOT_READY);
      expect(envelope.error.retryable).toBe(true);
    }
    // If the first interval already elapsed, 200 is legitimate — the point
    // below is that it MUST become ready and stay contract-valid.

    const deadline = Date.now() + 5_000;
    let summary: unknown;
    for (;;) {
      const res = await fetch(`${base}/system`, { headers });
      if (res.status === 200) {
        summary = await res.json();
        break;
      }
      expect(res.status).toBe(503);
      if (Date.now() > deadline) {
        throw new Error('agent never became ready');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const parsed = systemSummarySchema.parse(summary);
    expect(parsed.cpu.perCorePercent.length).toBeGreaterThan(0);
    expect(parsed.memory.usedBytes + parsed.memory.freeBytes).toBeLessThanOrEqual(
      parsed.memory.totalBytes + 1, // rounding guard
    );
    expect(parsed.platform).toBe(process.platform);
  });

  it('requires auth like every other route', async () => {
    const res = await fetch(`${base}/system`);
    expect(res.status).toBe(401);
  });
});
