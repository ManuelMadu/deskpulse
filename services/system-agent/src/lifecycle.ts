import { AGENT_EXIT_CODES } from '@deskpulse/contracts';

import type { AgentInstance } from './agent.js';
import type { AgentLogging } from './logging.js';
import type { AgentReadyHandshake } from '@deskpulse/contracts';

/** SIGTERM → clean exit must complete inside this budget (PDD §19: ≤ 3 s). */
const SHUTDOWN_DEADLINE_MS = 2_500;

export { AGENT_EXIT_CODES };

export function printReadyHandshake(port: number, version: string): void {
  const handshake: AgentReadyHandshake = {
    type: 'deskpulse-agent-ready',
    port,
    pid: process.pid,
    version,
  };
  process.stdout.write(`${JSON.stringify(handshake)}\n`);
}

/**
 * Wires SIGTERM/SIGINT graceful shutdown and crash-fast handlers for
 * unhandled errors. The agent never limps along in an unknown state: on an
 * unhandled rejection/exception it logs and exits 1 so the supervisor
 * restarts it (PDD §19).
 */
export function installLifecycleHandlers(agent: AgentInstance, logging: AgentLogging): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logging.logger.info({ subsystem: 'lifecycle', signal }, 'shutdown requested');

    // Tell live SSE clients we're going down before we cut the stream, so the
    // UI shows "stopping" rather than an unexplained disconnect (PDD §19).
    agent.bus.publish({
      type: 'agent.status',
      status: 'stopping',
      pid: process.pid,
      version: agent.version,
      runId: agent.runId,
    });

    // Failsafe: if graceful close hangs, exit inside the deadline anyway.
    const failsafe = setTimeout(() => {
      logging.logger.error({ subsystem: 'lifecycle' }, 'graceful shutdown deadline exceeded');
      logging.close();
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    failsafe.unref();

    agent
      .close()
      .then(() => {
        logging.logger.info({ subsystem: 'lifecycle' }, 'shutdown complete');
        logging.close();
        process.exit(0);
      })
      .catch((error: unknown) => {
        logging.logger.error(
          { subsystem: 'lifecycle', err: String(error) },
          'error during shutdown',
        );
        logging.close();
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logging.logger.fatal(
      { subsystem: 'lifecycle', err: error.stack ?? String(error) },
      'uncaught exception — exiting for supervisor restart',
    );
    logging.close();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logging.logger.fatal(
      { subsystem: 'lifecycle', err: String(reason) },
      'unhandled rejection — exiting for supervisor restart',
    );
    logging.close();
    process.exit(1);
  });
}
