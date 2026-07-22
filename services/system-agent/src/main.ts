/**
 * Executable entry bundled to dist/agent.cjs and spawned by the supervisor
 * with ELECTRON_RUN_AS_NODE=1. Startup order matters: token check (exit 78)
 * → logging → server (exit 71 on bind failure) → handshake → signal handlers.
 */
import { AGENT_VERSION, startAgent } from './agent.js';
import { AGENT_EXIT_CODES, installLifecycleHandlers, printReadyHandshake } from './lifecycle.js';
import { createAgentLogging } from './logging.js';
import { startOrphanGuard } from './orphan-guard.js';

const token = process.env['DESKPULSE_AGENT_TOKEN'];
if (token === undefined || token.length === 0) {
  process.stderr.write('DESKPULSE_AGENT_TOKEN is not set; refusing to start.\n');
  process.exit(AGENT_EXIT_CODES.noToken);
}

const logging = createAgentLogging();
logging.logger.info({ subsystem: 'lifecycle', version: AGENT_VERSION }, 'agent starting');

startAgent({
  token,
  onError: (error) =>
    logging.logger.error({ subsystem: 'http', err: String(error) }, 'route handler error'),
})
  .then((server) => {
    installLifecycleHandlers(server, logging);
    // Self-terminate if Main dies without SIGTERMing us (PDD §28): no orphan
    // agent survives a `kill -9` of the app.
    startOrphanGuard({
      onOrphaned: () => {
        logging.logger.warn({ subsystem: 'lifecycle' }, 'parent gone; self-terminating');
        logging.close();
        process.exit(0);
      },
    });
    printReadyHandshake(server.port, AGENT_VERSION);
    logging.logger.info({ subsystem: 'lifecycle', port: server.port }, 'agent ready');
  })
  .catch((error: unknown) => {
    logging.logger.fatal({ subsystem: 'lifecycle', err: String(error) }, 'listen failed');
    logging.close();
    process.stderr.write(`agent failed to start: ${String(error)}\n`);
    process.exit(AGENT_EXIT_CODES.listenFailure);
  });
