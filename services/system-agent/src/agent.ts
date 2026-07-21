import { Router } from './http/router.js';
import { createHealthRoute } from './http/routes/health.js';
import { createSystemRoute } from './http/routes/system.js';
import { startAgentServer } from './http/server.js';
import { METRICS_INTERVAL_MS, MetricsSampler } from './monitoring/metrics.js';

import type { AgentServer } from './http/server.js';

export const AGENT_VERSION = '0.1.0';

export interface AgentOptions {
  token: string;
  onError?: (error: unknown) => void;
  /** Test override; production uses METRICS_INTERVAL_MS (PDD FR-1). */
  metricsIntervalMs?: number;
}

/**
 * Assembles the agent: subsystems + routes + authenticated server. The
 * returned close() tears down every subsystem — timers must never outlive
 * the server (PDD code-quality rules).
 */
export async function startAgent(options: AgentOptions): Promise<AgentServer> {
  const sampler = new MetricsSampler(options.metricsIntervalMs ?? METRICS_INTERVAL_MS);
  sampler.start();

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
    close: async () => {
      sampler.stop();
      await server.close();
    },
  };
}
