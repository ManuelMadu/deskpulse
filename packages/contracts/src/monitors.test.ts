import { describe, expect, it } from 'vitest';

import { agentEventSchema } from './events.js';
import monitorFixture from './fixtures/monitor-with-status.json' with { type: 'json' };
import {
  isLoopbackUrl,
  monitorConfigInputSchema,
  monitorPatchSchema,
  monitorWithStatusSchema,
} from './monitors.js';

describe('isLoopbackUrl', () => {
  it('accepts http/https on loopback hosts', () => {
    for (const url of [
      'http://localhost:3000/healthz',
      'http://127.0.0.1:8080',
      'https://127.0.0.1/status',
      'http://[::1]:9000/',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
  });

  it('rejects non-loopback hosts, bad schemes, and garbage', () => {
    for (const url of [
      'http://example.com',
      'http://192.168.1.5:3000',
      'ftp://127.0.0.1',
      'file:///etc/passwd',
      'not a url',
      'http://127.0.0.1.evil.com',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });
});

describe('monitor config input schema', () => {
  it('applies documented defaults', () => {
    expect(monitorConfigInputSchema.parse({ name: 'API', url: 'http://127.0.0.1:3000' })).toEqual({
      name: 'API',
      url: 'http://127.0.0.1:3000',
      method: 'GET',
      intervalSeconds: 30,
      timeoutMs: 5000,
      expectedStatus: { min: 200, max: 399 },
      failureThreshold: 3,
      recoveryThreshold: 1,
      enabled: true,
    });
  });

  it('rejects out-of-range values, non-loopback urls, and unknown fields', () => {
    const base = { name: 'x', url: 'http://127.0.0.1:3000' };
    expect(monitorConfigInputSchema.safeParse({ ...base, url: 'http://evil.com' }).success).toBe(
      false,
    );
    expect(monitorConfigInputSchema.safeParse({ ...base, intervalSeconds: 4 }).success).toBe(false);
    expect(monitorConfigInputSchema.safeParse({ ...base, timeoutMs: 100 }).success).toBe(false);
    expect(monitorConfigInputSchema.safeParse({ ...base, failureThreshold: 11 }).success).toBe(
      false,
    );
    expect(monitorConfigInputSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(monitorConfigInputSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it('rejects an inverted expectedStatus range', () => {
    expect(
      monitorConfigInputSchema.safeParse({
        name: 'x',
        url: 'http://127.0.0.1:3000',
        expectedStatus: { min: 400, max: 200 },
      }).success,
    ).toBe(false);
  });
});

describe('monitor patch schema', () => {
  it('allows partial updates and an empty patch', () => {
    expect(monitorPatchSchema.parse({})).toEqual({});
    expect(monitorPatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('still enforces field rules on the fields present', () => {
    expect(monitorPatchSchema.safeParse({ intervalSeconds: 999999 }).success).toBe(false);
    expect(monitorPatchSchema.safeParse({ url: 'http://evil.com' }).success).toBe(false);
  });
});

describe('monitor with status', () => {
  it('round-trips the documented fixture (PDD §20)', () => {
    expect(monitorWithStatusSchema.parse(monitorFixture)).toEqual(monitorFixture);
  });
});

describe('monitor events', () => {
  it('parses monitor.result, monitor.unhealthy, monitor.recovered', () => {
    const id = '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71';
    const events = [
      {
        type: 'monitor.result',
        monitorId: id,
        at: '2026-07-21T10:15:02.100Z',
        ok: true,
        statusCode: 200,
        latencyMs: 12,
      },
      {
        type: 'monitor.unhealthy',
        monitorId: id,
        name: 'API',
        at: '2026-07-21T10:15:02.100Z',
        consecutiveFailures: 3,
        lastReason: 'connection-refused',
      },
      {
        type: 'monitor.recovered',
        monitorId: id,
        name: 'API',
        at: '2026-07-21T10:15:02.100Z',
        downtimeSeconds: 42,
      },
    ];
    for (const event of events) {
      expect(agentEventSchema.safeParse(event).success, event.type).toBe(true);
    }
  });
});
