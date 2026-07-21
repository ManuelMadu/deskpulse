import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { sendJson } from './respond.js';
import { Router } from './router.js';

import type { AddressInfo } from 'node:net';

async function withRouter(router: Router, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    void router.dispatch(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('micro-router', () => {
  it('matches exact routes and captures :params', async () => {
    const router = new Router();
    router.add('GET', '/monitors/:id', ({ res, params }) => {
      sendJson(res, 200, { id: params['id'] });
    });

    await withRouter(router, async (base) => {
      const res = await fetch(`${base}/monitors/abc%20def`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'abc def' });
    });
  });

  it('returns the NOT_FOUND envelope for unknown paths and wrong methods', async () => {
    const router = new Router();
    router.add('GET', '/health', ({ res }) => sendJson(res, 200, { ok: true }));

    await withRouter(router, async (base) => {
      for (const [method, path] of [
        ['GET', '/nope'],
        ['POST', '/health'],
        ['GET', '/health/extra'],
      ] as const) {
        const res = await fetch(`${base}${path}`, { method });
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: { code: string; retryable: boolean } };
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.retryable).toBe(false);
      }
    });
  });
});
