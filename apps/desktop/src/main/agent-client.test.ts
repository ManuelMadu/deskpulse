import { createServer } from 'node:http';

import { DeskPulseError, healthResponseSchema } from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentClient } from './agent-client.js';

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Fixture server impersonating the agent: route behavior keyed by path so
 * each test exercises one client failure mode over a real socket.
 */
let server: Server;
let port: number;

const VALID_HEALTH = {
  status: 'ok',
  pid: 4321,
  version: '0.1.0',
  uptimeSeconds: 1.5,
  activeWatches: 0,
  activeMonitors: 0,
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    switch (req.url) {
      case '/ok':
        return respond(200, VALID_HEALTH);
      case '/malformed':
        return respond(200, { status: 'ok', unexpected: true });
      case '/enveloped-error':
        return respond(503, {
          error: { code: 'NOT_READY', message: 'First sample pending.', retryable: true },
        });
      case '/bare-error':
        return respond(500, 'not json at all');
      case '/hang':
        return; // never respond → client timeout
      default:
        return respond(404, { error: { code: 'NOT_FOUND', message: 'nope', retryable: false } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function client(): AgentClient {
  return new AgentClient(() => ({ port, token: 'test-token' }));
}

async function errorFrom(promise: Promise<unknown>): Promise<DeskPulseError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DeskPulseError);
  return error as DeskPulseError;
}

describe('AgentClient', () => {
  it('parses a contract-valid response', async () => {
    const health = await client().get('/ok', healthResponseSchema);
    expect(health).toEqual(VALID_HEALTH);
  });

  it('maps a schema-invalid 200 to MALFORMED_RESPONSE', async () => {
    const error = await errorFrom(client().get('/malformed', healthResponseSchema));
    expect(error.code).toBe('MALFORMED_RESPONSE');
    expect(error.retryable).toBe(false);
  });

  it('rethrows the agent error envelope with its original code', async () => {
    const error = await errorFrom(client().get('/enveloped-error', healthResponseSchema));
    expect(error.code).toBe('NOT_READY');
    expect(error.retryable).toBe(true);
  });

  it('maps a non-envelope error body to MALFORMED_RESPONSE', async () => {
    const error = await errorFrom(client().get('/bare-error', healthResponseSchema));
    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('reports AGENT_UNAVAILABLE when no agent endpoint exists', async () => {
    const detached = new AgentClient(() => undefined);
    const error = await errorFrom(detached.get('/ok', healthResponseSchema));
    expect(error.code).toBe('AGENT_UNAVAILABLE');
    expect(error.retryable).toBe(true);
  });

  it('reports AGENT_UNAVAILABLE for a refused connection', async () => {
    const dead = new AgentClient(() => ({ port: 1, token: 'x' }));
    const error = await errorFrom(dead.get('/ok', healthResponseSchema));
    expect(error.code).toBe('AGENT_UNAVAILABLE');
  });
});
