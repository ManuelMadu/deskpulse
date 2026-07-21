import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentEventConsumer } from './agent-events.js';

import type { AgentEndpoint } from './agent-client.js';
import type { AgentEvent } from '@deskpulse/contracts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const TOKEN = 'events-consumer-test-token';

let server: Server | undefined;
let consumer: AgentEventConsumer | undefined;

afterEach(async () => {
  consumer?.stop();
  consumer = undefined;
  if (server) {
    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  }
});

/** Fixture SSE server that emits `frames` then holds the connection open. */
function startFixture(
  frames: string[],
): Promise<{ port: number; lastAuth: () => string | undefined }> {
  let lastAuth: string | undefined;
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      lastAuth = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of frames) {
        res.write(frame);
      }
      // leave open so the consumer stays connected (no reconnect mid-test)
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server!.address() as AddressInfo).port, lastAuth: () => lastAuth });
    });
  });
}

function frame(id: number, event: AgentEvent): string {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timed out');
}

describe('AgentEventConsumer', () => {
  it('parses valid frames, sends the token, and drops malformed ones', async () => {
    const { port, lastAuth } = await startFixture([
      frame(1, { type: 'agent.warning', code: 'a', message: 'first' }),
      ': hb\n\n', // heartbeat, ignored
      'id: 2\nevent: log.entry\ndata: {"type":"log.entry","bogus":true}\n\n', // schema-invalid
      'id: 3\nevent: nope\ndata: not json\n\n', // non-JSON
      frame(4, { type: 'agent.warning', code: 'b', message: 'second' }),
    ]);

    const received: AgentEvent[] = [];
    const endpoint: AgentEndpoint = { port, token: TOKEN };
    consumer = new AgentEventConsumer(
      () => endpoint,
      (event) => received.push(event),
      () => undefined,
    );
    consumer.start();

    await waitFor(() => received.length === 2);
    expect(received.map((e) => (e.type === 'agent.warning' ? e.message : e.type))).toEqual([
      'first',
      'second',
    ]);
    expect(lastAuth()).toBe(`Bearer ${TOKEN}`);
  });

  it('resumes with Last-Event-ID after the stream drops', async () => {
    // First connection: emit one event then end the response to force reconnect.
    const seenLastEventIds: (string | undefined)[] = [];
    let connectionCount = 0;
    server = createServer((req, res) => {
      connectionCount += 1;
      seenLastEventIds.push(
        Array.isArray(req.headers['last-event-id'])
          ? req.headers['last-event-id'][0]
          : req.headers['last-event-id'],
      );
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (connectionCount === 1) {
        res.write(frame(7, { type: 'agent.warning', code: 'a', message: 'before-drop' }));
        res.end(); // drop → consumer reconnects
      }
      // second connection stays open
    });
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port));
    });

    const received: AgentEvent[] = [];
    consumer = new AgentEventConsumer(
      () => ({ port, token: TOKEN }),
      (event) => received.push(event),
      () => undefined,
    );
    consumer.start();

    await waitFor(() => connectionCount >= 2, 4_000);
    expect(seenLastEventIds[0]).toBeUndefined(); // first connect: no id
    expect(seenLastEventIds[1]).toBe('7'); // reconnect resumes from the last seen id
  });
});
