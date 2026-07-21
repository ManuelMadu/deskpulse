import { agentEventSchema } from '@deskpulse/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAgent } from '../src/agent.js';

import type { AgentInstance } from '../src/agent.js';
import type { AgentEvent } from '@deskpulse/contracts';

const TOKEN = 'sse-endpoint-test-token-0123456789abcdef';

interface Frame {
  id?: number;
  event?: string;
  data?: string;
}

/**
 * Reads SSE frames from a live /events stream until `stop` says enough, then
 * aborts. Skips heartbeat/comment frames.
 */
async function readFrames(
  base: string,
  headers: Record<string, string>,
  stop: (frames: Frame[]) => boolean,
  timeoutMs = 4_000,
): Promise<Frame[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${base}/events`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream', ...headers },
    signal: controller.signal,
  });
  if (response.status !== 200 || !response.body) {
    clearTimeout(timer);
    throw new Error(`stream did not open: ${response.status}`);
  }

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        if (!raw.startsWith(':')) {
          const frame: Frame = {};
          for (const line of raw.split('\n')) {
            if (line.startsWith('id: ')) frame.id = Number(line.slice(4));
            else if (line.startsWith('event: ')) frame.event = line.slice(7);
            else if (line.startsWith('data: ')) frame.data = line.slice(6);
          }
          frames.push(frame);
        }
        if (stop(frames)) {
          return frames;
        }
        split = buffer.indexOf('\n\n');
      }
    }
  } catch {
    // aborted — return whatever we collected
  } finally {
    clearTimeout(timer);
    controller.abort();
    reader.cancel().catch(() => undefined);
  }
  return frames;
}

function parseEvent(frame: Frame): AgentEvent {
  return agentEventSchema.parse(JSON.parse(frame.data ?? '{}'));
}

describe('GET /events SSE (DP P4-b)', () => {
  let agent: AgentInstance;
  let base: string;

  beforeAll(async () => {
    agent = await startAgent({ token: TOKEN, metricsIntervalMs: 60_000 });
    base = `http://127.0.0.1:${agent.port}`;
  });

  afterAll(async () => {
    await agent.close();
  });

  it('requires auth', async () => {
    const res = await fetch(`${base}/events`, { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });

  it('sends agent.status ready on connect and live events afterward', async () => {
    const framesPromise = readFrames(base, {}, (frames) =>
      frames.some((f) => f.event === 'agent.warning'),
    );
    // Give the stream a moment to open and register its subscriber.
    await new Promise((resolve) => setTimeout(resolve, 200));
    agent.bus.publish({ type: 'agent.warning', code: 'test', message: 'hello live' });

    const frames = await framesPromise;
    const ready = frames.find((f) => f.event === 'agent.status');
    expect(ready).toBeDefined();
    const readyEvent = parseEvent(ready!);
    expect(readyEvent.type === 'agent.status' && readyEvent.status).toBe('ready');
    expect(readyEvent.type === 'agent.status' && readyEvent.runId).toBe(agent.runId);

    const warning = frames.find((f) => f.event === 'agent.warning');
    expect(parseEvent(warning!)).toMatchObject({ message: 'hello live' });
    // connection cleaned up after abort
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(agent.sse.connectionCount).toBe(0);
  });

  it('replays missed events via Last-Event-ID', async () => {
    // Publish two events into the buffer with no live listener.
    const first = agent.bus.publish({ type: 'agent.warning', code: 'x', message: 'missed-1' });
    agent.bus.publish({ type: 'agent.warning', code: 'x', message: 'missed-2' });

    const frames = await readFrames(base, { 'last-event-id': String(first.id) }, (f) =>
      f.some((fr) => fr.data?.includes('missed-2')),
    );
    const messages = frames
      .filter((f) => f.event === 'agent.warning')
      .map((f) => (JSON.parse(f.data ?? '{}') as { message: string }).message);
    expect(messages).toContain('missed-2');
    expect(messages).not.toContain('missed-1'); // already seen (== first.id)
  });

  it('sends stream.reset when Last-Event-ID is from a future/other run', async () => {
    const frames = await readFrames(base, { 'last-event-id': '999999' }, (f) =>
      f.some((fr) => fr.event === 'stream.reset'),
    );
    const reset = frames.find((f) => f.event === 'stream.reset');
    expect(reset).toBeDefined();
    expect(parseEvent(reset!)).toMatchObject({ type: 'stream.reset', reason: 'new-run' });
  });

  it('rejects a third concurrent connection with 409 LIMIT_REACHED', async () => {
    const a = new AbortController();
    const b = new AbortController();
    try {
      const s1 = await fetch(`${base}/events`, {
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
        signal: a.signal,
      });
      const s2 = await fetch(`${base}/events`, {
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
        signal: b.signal,
      });
      expect(s1.status).toBe(200);
      expect(s2.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const s3 = await fetch(`${base}/events`, {
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
      });
      expect(s3.status).toBe(409);
      const body = JSON.parse(await s3.text()) as { error: { code: string } };
      expect(body.error.code).toBe('LIMIT_REACHED');
    } finally {
      a.abort();
      b.abort();
    }
  });
});
