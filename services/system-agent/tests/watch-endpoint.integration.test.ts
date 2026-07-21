import {
  chmodSync,
  mkdtempSync,
  appendFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ERROR_CODES, errorEnvelopeSchema, watchCreatedSchema } from '@deskpulse/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startAgent } from '../src/agent.js';

import type { AgentInstance } from '../src/agent.js';

const TOKEN = 'watch-endpoint-test-token-0123456789abcd';

let dir: string;

describe('POST/DELETE /watch (DP P4-d)', () => {
  let agent: AgentInstance;
  let base: string;
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

  beforeAll(async () => {
    agent = await startAgent({
      token: TOKEN,
      metricsIntervalMs: 60_000,
      watch: { tailerPollMs: 25 },
    });
    base = `http://127.0.0.1:${agent.port}`;
    dir = mkdtempSync(join(tmpdir(), 'deskpulse-watch-'));
  });

  afterEach(async () => {
    await agent.watches.closeAll();
  });

  afterAll(async () => {
    await agent.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function watch(body: unknown): Promise<Response> {
    return fetch(`${base}/watch`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  }

  it('starts a watch on a real file and returns the resolved position', async () => {
    const path = join(dir, 'ok.log');
    writeFileSync(path, 'hello\n');
    const res = await watch({ path, fromEnd: true });
    expect(res.status).toBe(201);
    const created = watchCreatedSchema.parse(await res.json());
    // realPath is symlink-resolved (macOS: /var → /private/var); path echoes input.
    expect(created.path).toBe(path);
    expect(created.realPath).toBe(realpathSync(path));
    expect(created.fileSizeBytes).toBe(6);
    expect(agent.watches.activeCount).toBe(1);

    const del = await fetch(`${base}/watch/${created.id}`, { method: 'DELETE', headers: auth });
    expect(del.status).toBe(204);
    expect(agent.watches.activeCount).toBe(0);
  });

  it('404s a non-existent file as FILE_NOT_FOUND', async () => {
    const res = await watch({ path: join(dir, 'nope.log') });
    expect(res.status).toBe(404);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(ERROR_CODES.FILE_NOT_FOUND);
  });

  it('422s a directory as NOT_A_FILE', async () => {
    const res = await watch({ path: dir });
    expect(res.status).toBe(422);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(ERROR_CODES.NOT_A_FILE);
  });

  it('400s a relative path before touching the filesystem', async () => {
    const res = await watch({ path: 'relative.log' });
    expect(res.status).toBe(400);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('403s an unreadable file as PERMISSION_DENIED', async () => {
    if (process.getuid?.() === 0) {
      return;
    }
    const path = join(dir, 'locked.log');
    writeFileSync(path, 'secret\n');
    chmodSync(path, 0o000);
    try {
      const res = await watch({ path });
      expect(res.status).toBe(403);
      expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(
        ERROR_CODES.PERMISSION_DENIED,
      );
    } finally {
      chmodSync(path, 0o644);
    }
  });

  it('enforces the 5-watch limit with 409 LIMIT_REACHED', async () => {
    for (let i = 0; i < 5; i += 1) {
      const path = join(dir, `w${i}.log`);
      writeFileSync(path, '');
      expect((await watch({ path })).status).toBe(201);
    }
    const sixth = join(dir, 'w6.log');
    writeFileSync(sixth, '');
    const res = await watch({ path: sixth });
    expect(res.status).toBe(409);
    expect(errorEnvelopeSchema.parse(await res.json()).error.code).toBe(ERROR_CODES.LIMIT_REACHED);
  });

  it('delivers appended lines as log.entry events over SSE', async () => {
    const path = join(dir, 'stream.log');
    writeFileSync(path, '');
    const created = watchCreatedSchema.parse(await (await watch({ path, fromEnd: true })).json());

    const lines: string[] = [];
    const unsubscribe = agent.bus.subscribe((published) => {
      if (published.event.type === 'log.entry' && published.event.watchId === created.id) {
        lines.push(...published.event.entries.map((e) => e.line));
      }
    });

    appendFileSync(path, 'streamed-1\nstreamed-2\n');
    const deadline = Date.now() + 2_000;
    while (!lines.includes('streamed-2') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 15));
    }
    unsubscribe();
    expect(lines).toContain('streamed-1');
    expect(lines).toContain('streamed-2');
  });
});
