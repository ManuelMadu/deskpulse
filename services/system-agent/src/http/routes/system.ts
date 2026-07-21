import { ERROR_CODES } from '@deskpulse/contracts';

import { sendError, sendJson } from '../respond.js';

import type { MetricsSampler } from '../../monitoring/metrics.js';
import type { RouteHandler } from '../router.js';

/** GET /system — cached latest sample; 503 NOT_READY before the first one. */
export function createSystemRoute(sampler: MetricsSampler): RouteHandler {
  return ({ res }) => {
    const summary = sampler.latest();
    if (!summary) {
      sendError(res, {
        code: ERROR_CODES.NOT_READY,
        message: 'First metrics sample is not ready yet.',
        retryable: true,
      });
      return;
    }
    sendJson(res, 200, summary);
  };
}
