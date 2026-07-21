import { ERROR_HTTP_STATUS } from '@deskpulse/contracts';

import type { DeskPulseErrorShape } from '@deskpulse/contracts';
import type { ServerResponse } from 'node:http';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, shape: DeskPulseErrorShape): void {
  sendJson(res, ERROR_HTTP_STATUS[shape.code] ?? 500, { error: shape });
}
