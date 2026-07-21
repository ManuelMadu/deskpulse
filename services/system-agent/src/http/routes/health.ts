import { sendJson } from '../respond.js';

import type { RouteHandler } from '../router.js';
import type { HealthResponse } from '@deskpulse/contracts';

export interface HealthCounters {
  activeWatches(): number;
  activeMonitors(): number;
}

/**
 * GET /health — if the process can answer, it reports ok; subsystem
 * degradation travels as agent.warning events, never as a health failure
 * (PDD §20). Auth errors are the only possible failure here.
 */
export function createHealthRoute(version: string, counters: HealthCounters): RouteHandler {
  return ({ res }) => {
    const body: HealthResponse = {
      status: 'ok',
      pid: process.pid,
      version,
      uptimeSeconds: process.uptime(),
      activeWatches: counters.activeWatches(),
      activeMonitors: counters.activeMonitors(),
    };
    sendJson(res, 200, body);
  };
}
