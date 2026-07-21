import { Router } from './http/router.js';
import { createHealthRoute } from './http/routes/health.js';
import { startAgentServer } from './http/server.js';

import type { AgentServer } from './http/server.js';

export const AGENT_VERSION = '0.1.0';

/**
 * Assembles the agent: routes + authenticated server. Monitoring subsystems
 * plug their routes and counters in here as later phases land.
 */
export async function startAgent(options: {
  token: string;
  onError?: (error: unknown) => void;
}): Promise<AgentServer> {
  const router = new Router();
  router.add(
    'GET',
    '/health',
    createHealthRoute(AGENT_VERSION, {
      activeWatches: () => 0,
      activeMonitors: () => 0,
    }),
  );

  const startOptions: Parameters<typeof startAgentServer>[0] = {
    token: options.token,
    router,
  };
  if (options.onError) {
    startOptions.onError = options.onError;
  }
  return startAgentServer(startOptions);
}
