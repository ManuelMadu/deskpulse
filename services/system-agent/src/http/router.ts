import { ERROR_CODES } from '@deskpulse/contracts';

import { sendError } from './respond.js';

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Readonly<Record<string, string>>;
  url: URL;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

/**
 * Deliberately tiny router (PDD OD-2): exact-segment matching with `:param`
 * captures, no wildcards, no middleware chain. Eleven routes don't need more,
 * and every line here is auditable.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler });
    return this;
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const segments = url.pathname.split('/').filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== req.method || route.segments.length !== segments.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const expected = route.segments[i]!;
        const actual = segments[i]!;
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) {
        await route.handler({ req, res, params, url });
        return;
      }
    }

    sendError(res, {
      code: ERROR_CODES.NOT_FOUND,
      message: `No route for ${req.method ?? '?'} ${url.pathname}`,
      retryable: false,
    });
  }
}
