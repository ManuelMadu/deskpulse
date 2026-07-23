import { DeskPulseError, ERROR_CODES, exportRequestSchema } from '@deskpulse/contracts';

import { BodyError, readJsonBody } from '../body.js';
import { sendError, sendJson } from '../respond.js';

import type { DiagnosticsExporter } from '../../diagnostics/export.js';
import type { RouteHandler } from '../router.js';

/**
 * POST /diagnostics/export (PDD §20) — kick off an async, single-flight bundle
 * build. Returns 202 with the exportId + staging path; completion/failure
 * arrives as `diagnostics.progress` SSE events. 409 if one is already running,
 * 507 if there isn't room on disk.
 */
export function createDiagnosticsExportRoute(exporter: DiagnosticsExporter): RouteHandler {
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

    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendError(res, {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Invalid export request.',
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        retryable: false,
      });
      return;
    }

    try {
      sendJson(res, 202, await exporter.start(parsed.data));
    } catch (error) {
      sendError(
        res,
        error instanceof DeskPulseError
          ? error.toShape()
          : { code: ERROR_CODES.INTERNAL, message: 'Failed to start export.', retryable: true },
      );
    }
  };
}
