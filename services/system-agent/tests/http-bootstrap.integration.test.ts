import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';

import {
  ERROR_CODES,
  LIMITS,
  errorEnvelopeSchema,
  healthResponseSchema,
} from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAgent } from '../src/agent.js';
import { BodyError, readJsonBody } from '../src/http/body.js';
import { sendError, sendJson } from '../src/http/respond.js';
import { Router } from '../src/http/router.js';
import { startAgentServer } from '../src/http/server.js';

import type { AgentServer } from '../src/http/server.js';

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';

describe('agent HTTP bootstrap (DP-5)', () => {
  let agent: AgentServer;
  let base: string;

  beforeAll(async () => {
    agent = await startAgent({ token: TOKEN });
    base = `http://127.0.0.1:${agent.port}`;
  });

  afterAll(async () => {
    await agent.close();
  });

  it('rejects requests without a token: 401 AUTH_REQUIRED', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(401);
    const envelope = errorEnvelopeSchema.parse(await res.json());
    expect(envelope.error.code).toBe(ERROR_CODES.AUTH_REQUIRED);
  });

  it('rejects requests with a wrong token: 401 AUTH_INVALID', async () => {
    const res = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${'x'.repeat(64)}` },
    });
    expect(res.status).toBe(401);
    const envelope = errorEnvelopeSchema.parse(await res.json());
    expect(envelope.error.code).toBe(ERROR_CODES.AUTH_INVALID);
  });

  it('serves an authed /health that satisfies the contract schema', async () => {
    const res = await fetch(`${base}/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const health = healthResponseSchema.parse(await res.json());
    expect(health.pid).toBe(process.pid);
    expect(health.activeWatches).toBe(0);
    expect(health.activeMonitors).toBe(0);
  });

  it('authenticates before routing: unknown paths still 401 without a token', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`);
    expect(res.status).toBe(401);
  });

  it('returns NOT_FOUND envelope for unknown authed routes', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
    const envelope = errorEnvelopeSchema.parse(await res.json());
    expect(envelope.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('binds to loopback only: the same port on LAN interfaces refuses connections', async () => {
    const lanAddresses = Object.values(networkInterfaces())
      .flat()
      .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
      .map((iface) => iface!.address);

    if (lanAddresses.length === 0) {
      // No external interface on this machine (e.g. CI runner without LAN) —
      // fall back to asserting the reported bind address is loopback.
      const address = agent.server.address();
      expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
      return;
    }

    for (const lanAddress of lanAddresses) {
      const refused = await new Promise<boolean>((resolve) => {
        const socket = connect({ host: lanAddress, port: agent.port, timeout: 2_000 });
        socket.on('connect', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('error', () => resolve(true));
        socket.on('timeout', () => {
          socket.destroy();
          resolve(true);
        });
      });
      expect(refused, `connection via ${lanAddress}:${agent.port} must be refused`).toBe(true);
    }
  });
});

describe('JSON body limit (DP-5)', () => {
  it('accepts small bodies and rejects oversized or malformed ones through a real route', async () => {
    const router = new Router();
    router.add('POST', '/echo', async ({ req, res }) => {
      try {
        sendJson(res, 200, { received: await readJsonBody(req) });
      } catch (error) {
        if (error instanceof BodyError) {
          sendError(res, { code: error.code, message: error.message, retryable: false });
          return;
        }
        throw error;
      }
    });

    const server = await startAgentServer({ token: TOKEN, router });
    const echoBase = `http://127.0.0.1:${server.port}`;
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    };

    try {
      const ok = await fetch(`${echoBase}/echo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ hello: 'world' }),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ received: { hello: 'world' } });

      const oversized = await fetch(`${echoBase}/echo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ blob: 'x'.repeat(LIMITS.maxRequestBodyBytes + 1024) }),
      });
      expect(oversized.status).toBe(413);
      const envelope = errorEnvelopeSchema.parse(await oversized.json());
      expect(envelope.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);

      const malformed = await fetch(`${echoBase}/echo`, {
        method: 'POST',
        headers,
        body: '{not json',
      });
      expect(malformed.status).toBe(400);
      expect(errorEnvelopeSchema.parse(await malformed.json()).error.code).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    } finally {
      await server.close();
    }
  });
});
