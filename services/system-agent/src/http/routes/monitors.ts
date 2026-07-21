import {
  DeskPulseError,
  ERROR_CODES,
  monitorConfigInputSchema,
  monitorPatchSchema,
} from '@deskpulse/contracts';

import { BodyError, readJsonBody } from '../body.js';
import { sendError, sendJson } from '../respond.js';

import type { HealthRegistry } from '../../monitoring/health-registry.js';
import type { RouteHandler } from '../router.js';
import type { ServerResponse } from 'node:http';

function validationError(res: ServerResponse, issues: { path: string; message: string }[]): void {
  sendError(res, {
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Invalid monitor configuration.',
    details: { issues },
    retryable: false,
  });
}

function handleServiceError(res: ServerResponse, error: unknown): void {
  sendError(
    res,
    error instanceof DeskPulseError
      ? error.toShape()
      : { code: ERROR_CODES.INTERNAL, message: 'Monitor operation failed.', retryable: true },
  );
}

/** GET /monitors — all monitors with embedded runtime status (PDD §20). */
export function createListMonitorsRoute(registry: HealthRegistry): RouteHandler {
  return ({ res }) => sendJson(res, 200, registry.list());
}

/** POST /monitors — create; probing starts immediately if enabled. */
export function createCreateMonitorRoute(registry: HealthRegistry): RouteHandler {
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
    const parsed = monitorConfigInputSchema.safeParse(body);
    if (!parsed.success) {
      validationError(
        res,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
      return;
    }
    try {
      sendJson(res, 201, registry.add(parsed.data));
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}

/** PATCH /monitors/:id — partial update. */
export function createUpdateMonitorRoute(registry: HealthRegistry): RouteHandler {
  return async ({ req, res, params }) => {
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
    const parsed = monitorPatchSchema.safeParse(body);
    if (!parsed.success) {
      validationError(
        res,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
      return;
    }
    try {
      sendJson(res, 200, registry.update(params['id'] ?? '', parsed.data));
    } catch (error) {
      handleServiceError(res, error);
    }
  };
}

/** DELETE /monitors/:id — idempotent from Main's perspective. */
export function createDeleteMonitorRoute(registry: HealthRegistry): RouteHandler {
  return ({ res, params }) => {
    if (registry.remove(params['id'] ?? '')) {
      res.writeHead(204).end();
    } else {
      sendError(res, {
        code: ERROR_CODES.NOT_FOUND,
        message: 'No such monitor.',
        retryable: false,
      });
    }
  };
}
