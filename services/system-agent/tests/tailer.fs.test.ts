import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Tailer } from '../src/monitoring/tailer.js';

import type { TailerOptions } from '../src/monitoring/tailer.js';
import type { AgentEvent } from '@deskpulse/contracts';

const WATCH_ID = '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71';

let dir: string;
const tailers: Tailer[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deskpulse-tailer-'));
});

afterEach(async () => {
  await Promise.all(tailers.splice(0).map((t) => t.stop()));
  rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  events: AgentEvent[];
  lines: () => string[];
  waitFor: (predicate: () => boolean, label: string, timeoutMs?: number) => Promise<void>;
  start: () => Promise<{ startOffset: number; fileSizeBytes: number }>;
}

function makeTailer(
  path: string,
  overrides: Partial<TailerOptions> = {},
): {
  tailer: Tailer;
  harness: Harness;
} {
  const events: AgentEvent[] = [];
  const tailer = new Tailer({
    watchId: WATCH_ID,
    realPath: path,
    fromEnd: false,
    encoding: 'utf8',
    emit: (event) => events.push(event),
    pollMs: 25,
    recreationWindowMs: 300,
    permissionRetryMs: 40,
    permissionMaxRetries: 3,
    ...overrides,
  });
  tailers.push(tailer);

  const harness: Harness = {
    events,
    lines: () =>
      events.flatMap((e) => (e.type === 'log.entry' ? e.entries.map((entry) => entry.line) : [])),
    async waitFor(predicate, label, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 15));
      }
      throw new Error(`timed out waiting for: ${label}\nevents: ${JSON.stringify(events)}`);
    },
    start: () => tailer.start(),
  };
  return { tailer, harness };
}

describe('Tailer — append and backfill', () => {
  it('streams appended lines within the poll window', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'seed\n');
    const { harness } = makeTailer(path, { fromEnd: true });
    await harness.start();

    appendFileSync(path, 'one\ntwo\n');
    await harness.waitFor(() => harness.lines().includes('two'), 'two appended');
    expect(harness.lines()).toEqual(['one', 'two']); // seed skipped (fromEnd)
  });

  it('backfills from existing content when fromEnd is false', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'old-1\nold-2\n');
    const { harness } = makeTailer(path, { fromEnd: false });
    const { startOffset } = await harness.start();
    expect(startOffset).toBe(0);
    await harness.waitFor(() => harness.lines().includes('old-2'), 'backfill');
    expect(harness.lines()).toEqual(['old-1', 'old-2']);
  });

  it('caps backfill to the last 1 MiB', async () => {
    const path = join(dir, 'big.log');
    writeFileSync(path, 'x'.repeat(2 * 1024 * 1024) + '\n');
    const { harness } = makeTailer(path, { fromEnd: false });
    const { startOffset, fileSizeBytes } = await harness.start();
    expect(fileSizeBytes).toBeGreaterThan(1024 * 1024);
    expect(startOffset).toBe(fileSizeBytes - 1024 * 1024);
  });

  it('reports monotonic offsets that track file bytes', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, '');
    const { harness } = makeTailer(path, { fromEnd: true });
    await harness.start();
    appendFileSync(path, 'aa\nbbb\n');
    await harness.waitFor(() => harness.lines().length === 2, 'two lines');
    const offsets = harness.events
      .filter((e) => e.type === 'log.entry')
      .flatMap((e) => (e.type === 'log.entry' ? e.entries.map((x) => x.offset) : []));
    expect(offsets).toEqual([3, 7]); // "aa\n" ends at 3, "bbb\n" ends at 7
  });
});

describe('Tailer — truncation', () => {
  it('detects shrink, emits log.truncated, and resumes from 0', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'first\nsecond\n');
    const { harness } = makeTailer(path, { fromEnd: false });
    await harness.start();
    await harness.waitFor(() => harness.lines().includes('second'), 'initial read');

    truncateSync(path, 0);
    appendFileSync(path, 'fresh\n');
    await harness.waitFor(
      () => harness.events.some((e) => e.type === 'log.truncated'),
      'truncated marker',
    );
    await harness.waitFor(() => harness.lines().includes('fresh'), 'post-truncation line');
  });
});

describe('Tailer — rotation', () => {
  it('drains the old file, emits log.rotated, and continues with zero lost lines', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'a\n');
    const { harness } = makeTailer(path, { fromEnd: false });
    await harness.start();
    appendFileSync(path, 'b\n');
    await harness.waitFor(() => harness.lines().includes('b'), 'pre-rotation lines');

    // logrotate-style: move the current file aside, create a fresh one.
    renameSync(path, join(dir, 'app.log.1'));
    writeFileSync(path, 'c\n');

    await harness.waitFor(
      () => harness.events.some((e) => e.type === 'log.rotated'),
      'rotated marker',
    );
    await harness.waitFor(() => harness.lines().includes('c'), 'post-rotation line');
    // no lost lines: a, b (drained), then c
    expect(harness.lines()).toEqual(['a', 'b', 'c']);
  });
});

describe('Tailer — deletion', () => {
  it('emits log.deleted then resumes as rotation when recreated within the window', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'a\n');
    const { harness } = makeTailer(path, { fromEnd: false, recreationWindowMs: 5_000 });
    await harness.start();
    await harness.waitFor(() => harness.lines().includes('a'), 'initial');

    unlinkSync(path);
    await harness.waitFor(
      () => harness.events.some((e) => e.type === 'log.deleted'),
      'deleted marker',
    );

    writeFileSync(path, 'reborn\n');
    await harness.waitFor(() => harness.lines().includes('reborn'), 'recreated line');
    expect(harness.events.some((e) => e.type === 'log.rotated')).toBe(true);
  });

  it('errors after the recreation window expires', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, 'a\n');
    const { harness } = makeTailer(path, { fromEnd: false, recreationWindowMs: 60 });
    await harness.start();
    unlinkSync(path);
    await harness.waitFor(
      () => harness.events.some((e) => e.type === 'log.error' && e.error.code === 'FILE_NOT_FOUND'),
      'expiry error',
    );
  });
});

describe('Tailer — long lines and floods', () => {
  it('truncates a line longer than 32 KiB and flags truncatedLines', async () => {
    const path = join(dir, 'app.log');
    writeFileSync(path, '');
    const { harness } = makeTailer(path, { fromEnd: true });
    await harness.start();
    appendFileSync(path, 'x'.repeat(40 * 1024) + '\n');
    await harness.waitFor(
      () => harness.events.some((e) => e.type === 'log.entry' && e.truncatedLines > 0),
      'truncated flag',
    );
  });

  it('accounts for every line under a 10k-line flood (delivered + dropped)', async () => {
    const path = join(dir, 'flood.log');
    writeFileSync(path, '');
    const { harness } = makeTailer(path, { fromEnd: true });
    await harness.start();

    const burst = Array.from({ length: 10_000 }, (_, i) => `line-${i}`).join('\n') + '\n';
    appendFileSync(path, burst);
    // A late line in a fresh rate-limit window carries the coalesced dropped count.
    await new Promise((r) => setTimeout(r, 1_100));
    appendFileSync(path, 'TAIL\n');

    await harness.waitFor(() => harness.lines().includes('TAIL'), 'tail line delivered', 4_000);

    let delivered = 0;
    let dropped = 0;
    for (const event of harness.events) {
      if (event.type === 'log.entry') {
        delivered += event.entries.length;
        dropped += event.dropped;
      }
    }
    expect(harness.events.some((e) => e.type === 'log.error')).toBe(false);
    expect(delivered + dropped).toBe(10_001); // every line accounted exactly once
    expect(dropped).toBeGreaterThan(0); // the rate cap engaged
    expect(delivered).toBeLessThan(10_001); // and it actually dropped some
  });
});

describe('Tailer — permissions', () => {
  it('rejects start() when the file cannot be opened', async () => {
    if (process.getuid?.() === 0) {
      return; // root bypasses permission bits
    }
    const path = join(dir, 'locked.log');
    writeFileSync(path, 'secret\n');
    chmodSync(path, 0o000);
    const { harness } = makeTailer(path, { fromEnd: false });
    await expect(harness.start()).rejects.toThrow();
    chmodSync(path, 0o644); // let afterEach clean up
  });
});
