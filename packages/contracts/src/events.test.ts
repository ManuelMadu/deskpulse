import { describe, expect, it } from 'vitest';

import { agentEventSchema } from './events.js';
import logEntryFixture from './fixtures/log-entry-event.json' with { type: 'json' };

const WATCH_ID = '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71';

describe('agent event union', () => {
  it('round-trips the documented log.entry fixture (PDD §21)', () => {
    expect(agentEventSchema.parse(logEntryFixture)).toEqual(logEntryFixture);
  });

  it('parses every Phase 4 event type', () => {
    const events = [
      {
        type: 'log.rotated',
        watchId: WATCH_ID,
        previousInode: 111,
        newInode: 222,
        resumedAtOffset: 0,
      },
      { type: 'log.truncated', watchId: WATCH_ID, previousSize: 4096, newSize: 0 },
      { type: 'log.deleted', watchId: WATCH_ID, path: '/tmp/app.log' },
      {
        type: 'log.error',
        watchId: WATCH_ID,
        error: { code: 'PERMISSION_DENIED', message: 'EACCES', retryable: true },
      },
      { type: 'agent.warning', code: 'sampler-error', message: 'ps failed once' },
      {
        type: 'agent.status',
        status: 'ready',
        pid: 123,
        version: '0.1.0',
        runId: 'a1b2c3d4e5f6',
      },
      { type: 'stream.reset', reason: 'new-run' },
    ];
    for (const event of events) {
      const result = agentEventSchema.safeParse(event);
      expect(result.success, `${event.type}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('rejects unknown event types and unknown fields', () => {
    expect(agentEventSchema.safeParse({ type: 'log.exploded', watchId: WATCH_ID }).success).toBe(
      false,
    );
    expect(agentEventSchema.safeParse({ ...logEntryFixture, sneaky: true }).success).toBe(false);
  });

  it('rejects empty batches and invalid nested error shapes', () => {
    expect(agentEventSchema.safeParse({ ...logEntryFixture, entries: [] }).success).toBe(false);
    expect(
      agentEventSchema.safeParse({
        type: 'log.error',
        watchId: WATCH_ID,
        error: { code: 'NOT_A_REAL_CODE', message: 'x', retryable: false },
      }).success,
    ).toBe(false);
  });
});
