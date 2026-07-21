import { createServer } from 'node:http';

import { ERROR_CODES } from '@deskpulse/contracts';

import { createTokenVerifier } from './auth.js';
import { sendError } from './respond.js';

import type { Router } from './router.js';
import type { Server } from 'node:http';

export interface AgentServer {
  server: Server;
  /** Loopback port the OS assigned. */
  port: number;
  close(): Promise<void>;
}

/**
 * Binds the agent's HTTP server to 127.0.0.1 on an OS-assigned port.
 * Auth runs before routing on every request — including /health and,
 * later, /events (PDD §20, §30).
 */
export async function startAgentServer(options: {
  token: string;
  router: Router;
  onError?: (error: unknown) => void;
}): Promise<AgentServer> {
  const verifier = createTokenVerifier(options.token);

  const server = createServer((req, res) => {
    const outcome = verifier.verify(req.headers.authorization);
    if (outcome !== 'ok') {
      sendError(res, {
        code: outcome === 'missing' ? ERROR_CODES.AUTH_REQUIRED : ERROR_CODES.AUTH_INVALID,
        message:
          outcome === 'missing'
            ? 'Authorization bearer token is required.'
            : 'Authorization bearer token is invalid.',
        retryable: false,
      });
      return;
    }

    options.router.dispatch(req, res).catch((error: unknown) => {
      options.onError?.(error);
      if (!res.headersSent) {
        sendError(res, {
          code: ERROR_CODES.INTERNAL,
          message: 'Internal error.',
          retryable: false,
        });
      } else {
        res.destroy();
      }
    });
  });

  // Never keep sockets alive long enough to outlive a SIGTERM grace period.
  server.keepAliveTimeout = 1_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('agent server bound to a non-TCP address');
  }

  return {
    server,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // In-flight keep-alive sockets would delay close(); drop them.
        server.closeAllConnections();
      }),
  };
}
