import { LIMITS } from '@deskpulse/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { stripAnsi } from './ansi.js';
import { useLogsStore } from './logs-store.js';

import type { AgentEvent, WatchHandle } from '@deskpulse/contracts';

const WATCH: WatchHandle = {
  watchId: '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71',
  displayPath: '/var/log/app.log',
  startOffset: 0,
  fileSizeBytes: 0,
};

function reset(): void {
  useLogsStore.setState({ watches: {}, order: [], activeWatchId: undefined, filter: '' });
}

function entry(lines: string[], dropped = 0): AgentEvent {
  return {
    type: 'log.entry',
    watchId: WATCH.watchId,
    entries: lines.map((line, i) => ({ line, offset: i + 1, at: '2026-07-21T10:15:02.100Z' })),
    dropped,
    truncatedLines: 0,
  };
}

describe('stripAnsi', () => {
  it('removes SGR color codes but keeps the text', () => {
    expect(stripAnsi('[31mred[0m normal')).toBe('red normal');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('GET /api 200 12ms')).toBe('GET /api 200 12ms');
  });
});

describe('logs store', () => {
  beforeEach(reset);

  it('adds a watch and makes it active', () => {
    useLogsStore.getState().addWatch(WATCH);
    const state = useLogsStore.getState();
    expect(state.order).toEqual([WATCH.watchId]);
    expect(state.activeWatchId).toBe(WATCH.watchId);
  });

  it('ingests log lines with ANSI stripped', () => {
    const store = useLogsStore.getState();
    store.addWatch(WATCH);
    store.ingest(entry(['[32mok[0m', 'second']));
    const rows = useLogsStore.getState().watches[WATCH.watchId]!.rows;
    expect(rows.map((r) => r.text)).toEqual(['ok', 'second']);
    expect(rows.every((r) => r.kind === 'line')).toBe(true);
  });

  it('inserts markers for rotation, truncation, deletion, and error', () => {
    const store = useLogsStore.getState();
    store.addWatch(WATCH);
    const events: AgentEvent[] = [
      {
        type: 'log.rotated',
        watchId: WATCH.watchId,
        previousInode: 1,
        newInode: 2,
        resumedAtOffset: 0,
      },
      { type: 'log.truncated', watchId: WATCH.watchId, previousSize: 10, newSize: 0 },
      { type: 'log.deleted', watchId: WATCH.watchId, path: '/var/log/app.log' },
      {
        type: 'log.error',
        watchId: WATCH.watchId,
        error: { code: 'PERMISSION_DENIED', message: 'EACCES', retryable: true },
      },
    ];
    for (const e of events) {
      store.ingest(e);
    }
    const view = useLogsStore.getState().watches[WATCH.watchId]!;
    const markers = view.rows.filter((r) => r.kind === 'marker').map((r) => r.text);
    expect(markers).toEqual([
      '— rotated —',
      '— truncated —',
      '— file deleted, watching for recreation —',
      '— error: EACCES —',
    ]);
    expect(view.status).toBe('error');
  });

  it('accumulates dropped counts', () => {
    const store = useLogsStore.getState();
    store.addWatch(WATCH);
    store.ingest(entry(['a'], 5));
    store.ingest(entry(['b'], 3));
    expect(useLogsStore.getState().watches[WATCH.watchId]!.droppedTotal).toBe(8);
  });

  it('bounds each watch to the ring buffer size', () => {
    const store = useLogsStore.getState();
    store.addWatch(WATCH);
    const lines = Array.from(
      { length: LIMITS.rendererLogRingBufferLines + 500 },
      (_, i) => `l${i}`,
    );
    // ingest in chunks to mimic batches
    for (let i = 0; i < lines.length; i += 100) {
      store.ingest(entry(lines.slice(i, i + 100)));
    }
    const rows = useLogsStore.getState().watches[WATCH.watchId]!.rows;
    expect(rows.length).toBe(LIMITS.rendererLogRingBufferLines);
    // the newest line survives, the oldest is evicted
    expect(rows[rows.length - 1]!.text).toBe(`l${lines.length - 1}`);
    expect(rows[0]!.text).not.toBe('l0');
  });

  it('drops events for unknown watches without throwing', () => {
    const store = useLogsStore.getState();
    expect(() => store.ingest(entry(['orphan']))).not.toThrow();
    expect(useLogsStore.getState().order).toEqual([]);
  });

  it('marks a gap on stream.reset for every open watch', () => {
    const store = useLogsStore.getState();
    store.addWatch(WATCH);
    store.ingest({ type: 'stream.reset', reason: 'new-run' });
    const rows = useLogsStore.getState().watches[WATCH.watchId]!.rows;
    expect(rows.at(-1)!.text).toBe('— gap —');
  });
});
