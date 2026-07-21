import { DeskPulseError, ERROR_CODES, processQuerySchema } from '@deskpulse/contracts';

import { sendError, sendJson } from '../respond.js';

import type { ProcessProvider } from '../../platform/darwin-processes.js';
import type { RouteHandler } from '../router.js';

/** GET /processes — validated query, 2 s-cached ps snapshot (PDD §20, FR-2). */
export function createProcessesRoute(provider: ProcessProvider): RouteHandler {
  return async ({ res, url }) => {
    const query = processQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) {
      sendError(res, {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Invalid query parameters.',
        details: {
          issues: query.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        retryable: false,
      });
      return;
    }

    try {
      sendJson(res, 200, await provider.list(query.data));
    } catch (error) {
      sendError(
        res,
        error instanceof DeskPulseError
          ? error.toShape()
          : {
              code: ERROR_CODES.INTERNAL,
              message: 'Failed to list processes.',
              retryable: true,
            },
      );
    }
  };
}
