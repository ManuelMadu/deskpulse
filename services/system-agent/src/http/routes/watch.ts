import { DeskPulseError, ERROR_CODES, startWatchRequestSchema } from '@deskpulse/contracts';

import { BodyError, readJsonBody } from '../body.js';
import { sendError, sendJson } from '../respond.js';

import type { WatchRegistry } from '../../monitoring/watch-registry.js';
import type { RouteHandler } from '../router.js';

/** POST /watch — start tailing a user-selected file (PDD §20). */
export function createStartWatchRoute(registry: WatchRegistry): RouteHandler {
  return async ({ req, res }) => {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      if (error instanceof BodyError) {
        sendError(res, { code: error.code, message: error.message, retryable: false });
        return;
      }
      throw error;
    }

    const parsed = startWatchRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendError(res, {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Invalid watch request.',
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        retryable: false,
      });
      return;
    }

    try {
      sendJson(res, 201, await registry.add(parsed.data));
    } catch (error) {
      sendError(
        res,
        error instanceof DeskPulseError
          ? error.toShape()
          : { code: ERROR_CODES.INTERNAL, message: 'Failed to start watch.', retryable: true },
      );
    }
  };
}

/** DELETE /watch/:id — stop tailing; idempotent from Main's perspective. */
export function createStopWatchRoute(registry: WatchRegistry): RouteHandler {
  return async ({ res, params }) => {
    const removed = await registry.remove(params['id'] ?? '');
    if (!removed) {
      sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'No such watch.',
        retryable: false,
      });
      return;
    }
    res.writeHead(204).end();
  };
}
