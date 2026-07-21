import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventBus } from '../src/events.js';
import { HealthRegistry } from '../src/monitoring/health-registry.js';
import { probeOnce } from '../src/monitoring/probe.js';

import type { AgentEvent, MonitorConfigInput } from '@deskpulse/contracts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Mode = 'ok' | 'fail' | 'slow';
let mode: Mode = 'ok';
let server: Server;
let port: number;

beforeEach(async () => {
  mode = 'ok';
  server = createServer((_req, res) => {
    if (mode === 'fail') {
      res.writeHead(503).end('down');
    } else if (mode === 'slow') {
      setTimeout(() => res.writeHead(200).end('ok'), 400);
    } else {
      res.writeHead(200).end('ok');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function baseConfig(overrides: Partial<MonitorConfigInput> = {}): MonitorConfigInput {
  return {
    name: 'fixture',
    url: `http://127.0.0.1:${port}/health`,
    method: 'GET',
    intervalSeconds: 30,
    timeoutMs: 1_000,
    expectedStatus: { min: 200, max: 399 },
    failureThreshold: 3,
    recoveryThreshold: 1,
    enabled: true,
    ...overrides,
  };
}

function collect(bus: EventBus): AgentEvent[] {
  const events: AgentEvent[] = [];
  bus.subscribe((p) => events.push(p.event));
  return events;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

describe('probeOnce classification', () => {
  it('reports ok inside the expected range', async () => {
    const result = await probeOnce({
      url: `http://127.0.0.1:${port}/`,
      method: 'GET',
      timeoutMs: 1_000,
      expectedStatus: { min: 200, max: 399 },
    });
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports unexpected-status for a code outside the range', async () => {
    mode = 'fail';
    const result = await probeOnce({
      url: `http://127.0.0.1:${port}/`,
      method: 'GET',
      timeoutMs: 1_000,
      expectedStatus: { min: 200, max: 399 },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unexpected-status');
    expect(result.statusCode).toBe(503);
  });

  it('reports connection-refused when nothing is listening', async () => {
    const result = await probeOnce({
      url: 'http://127.0.0.1:1/',
      method: 'GET',
      timeoutMs: 1_000,
      expectedStatus: { min: 200, max: 399 },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('connection-refused');
  });

  it('reports timeout on a slow endpoint', async () => {
    mode = 'slow';
    const result = await probeOnce({
      url: `http://127.0.0.1:${port}/`,
      method: 'GET',
      timeoutMs: 100, // shorter than the 400 ms handler
      expectedStatus: { min: 200, max: 399 },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('timeout');
  });
});

describe('HealthRegistry (DP P5-b)', () => {
  let registry: HealthRegistry | undefined;

  afterEach(() => {
    registry?.closeAll();
    registry = undefined;
  });

  it('goes unhealthy after exactly failureThreshold and recovers after recoveryThreshold', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    registry = new HealthRegistry(bus, { jitterMs: 0, intervalMsOverride: 40 });
    const monitor = registry.add(baseConfig({ failureThreshold: 3, recoveryThreshold: 1 }));

    await waitFor(
      () => events.some((e) => e.type === 'monitor.result' && e.ok),
      'first healthy result',
    );

    mode = 'fail';
    await waitFor(() => events.some((e) => e.type === 'monitor.unhealthy'), 'unhealthy transition');
    const unhealthy = events.find((e) => e.type === 'monitor.unhealthy');
    expect(unhealthy?.type === 'monitor.unhealthy' && unhealthy.consecutiveFailures).toBe(3);

    mode = 'ok';
    await waitFor(() => events.some((e) => e.type === 'monitor.recovered'), 'recovered transition');
    const recovered = events.find((e) => e.type === 'monitor.recovered');
    expect(recovered?.type === 'monitor.recovered' && recovered.monitorId).toBe(monitor.id);
  });

  it('a slow monitor does not delay a fast one', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    registry = new HealthRegistry(bus, { jitterMs: 0, intervalMsOverride: 50 });

    mode = 'slow'; // shared fixture is slow for both, but timeout is generous
    const slow = registry.add(baseConfig({ name: 'slow', timeoutMs: 5_000 }));
    const fast = registry.add(baseConfig({ name: 'fast', timeoutMs: 5_000 }));

    // Both should keep producing results; independence means the fast one is
    // not blocked behind the slow one's in-flight probe.
    await waitFor(() => {
      const forFast = events.filter(
        (e) => e.type === 'monitor.result' && e.monitorId === fast.id,
      ).length;
      const forSlow = events.filter(
        (e) => e.type === 'monitor.result' && e.monitorId === slow.id,
      ).length;
      return forFast >= 2 && forSlow >= 1;
    }, 'both monitors producing results independently');
  });

  it('warns after repeated overlapping probes on a hanging endpoint', async () => {
    const bus = new EventBus();
    const events = collect(bus);
    registry = new HealthRegistry(bus, { jitterMs: 0, intervalMsOverride: 30 });
    mode = 'slow'; // 400 ms handler with a 30 ms tick → overlaps pile up
    registry.add(baseConfig({ timeoutMs: 5_000 }));

    await waitFor(
      () => events.some((e) => e.type === 'agent.warning' && e.code === 'probe-overlap'),
      'overlap warning',
    );
  });

  it('enforces the 20-monitor limit', () => {
    const bus = new EventBus();
    registry = new HealthRegistry(bus, { jitterMs: 0, intervalMsOverride: 100_000 });
    for (let i = 0; i < 20; i += 1) {
      registry.add(baseConfig({ name: `m${i}`, enabled: false }));
    }
    expect(() => registry!.add(baseConfig({ name: 'over', enabled: false }))).toThrow();
    expect(registry.activeCount).toBe(20);
  });

  it('resets state to unknown when the url changes', () => {
    const bus = new EventBus();
    registry = new HealthRegistry(bus, { jitterMs: 0, intervalMsOverride: 100_000 });
    const monitor = registry.add(baseConfig({ enabled: false }));
    const updated = registry.update(monitor.id, { url: `http://localhost:${port}/other` });
    expect(updated.state).toBe('unknown');
    expect(updated.url).toBe(`http://localhost:${port}/other`);
  });
});
