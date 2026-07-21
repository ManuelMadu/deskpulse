import { randomUUID } from 'node:crypto';

import { Router } from './http/router.js';
import { createHealthRoute } from './http/routes/health.js';
import { createProcessesRoute } from './http/routes/processes.js';
import { createSystemRoute } from './http/routes/system.js';
import { createSseHub } from './http/sse.js';
import { startAgentServer } from './http/server.js';
import { EventBus } from './events.js';
import { METRICS_INTERVAL_MS, MetricsSampler } from './monitoring/metrics.js';
import { createDarwinProcessProvider } from './platform/darwin-processes.js';

import type { AgentServer } from './http/server.js';
import type { SseHub } from './http/sse.js';

export const AGENT_VERSION = '0.1.0';

export interface AgentOptions {
  token: string;
  onError?: (error: unknown) => void;
  /** Test override; production uses METRICS_INTERVAL_MS (PDD FR-1). */
  metricsIntervalMs?: number;
}

export interface AgentInstance extends AgentServer {
  bus: EventBus;
  sse: SseHub;
  version: string;
  /** Opaque per-process run identifier stamped on agent.status (PDD R5). */
  runId: string;
}

/**
 * Assembles the agent: subsystems + routes + authenticated server. The
 * returned close() tears down every subsystem — timers, watchers, and SSE
 * connections must never outlive the server (PDD code-quality rules).
 */
export async function startAgent(options: AgentOptions): Promise<AgentInstance> {
  const runId = randomUUID();
  const bus = new EventBus();

  const sampler = new MetricsSampler(options.metricsIntervalMs ?? METRICS_INTERVAL_MS);
  sampler.start();

  const sse = createSseHub(bus, { pid: process.pid, version: AGENT_VERSION, runId });

  const router = new Router();
  router.add(
    'GET',
    '/health',
    createHealthRoute(AGENT_VERSION, {
      activeWatches: () => 0,
      activeMonitors: () => 0,
    }),
  );
  router.add('GET', '/system', createSystemRoute(sampler));
  router.add('GET', '/processes', createProcessesRoute(createDarwinProcessProvider()));
  router.add('GET', '/events', sse.route);

  const startOptions: Parameters<typeof startAgentServer>[0] = {
    token: options.token,
    router,
  };
  if (options.onError) {
    startOptions.onError = options.onError;
  }

  let server: AgentServer;
  try {
    server = await startAgentServer(startOptions);
  } catch (error) {
    sampler.stop();
    throw error;
  }

  return {
    ...server,
    bus,
    sse,
    version: AGENT_VERSION,
    runId,
    close: async () => {
      sampler.stop();
      sse.closeAll();
      await server.close();
    },
  };
}
