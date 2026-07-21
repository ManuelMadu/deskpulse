/**
 * Executable entry bundled to dist/agent.cjs. DP-6 adds the formal readiness
 * handshake schema, SIGTERM shutdown, exit-code conventions, and pino logging.
 */
import { startAgent } from './agent.js';

const EXIT_NO_TOKEN = 78; // EX_CONFIG — spawned without DESKPULSE_AGENT_TOKEN

const token = process.env['DESKPULSE_AGENT_TOKEN'];
if (token === undefined || token.length === 0) {
  process.stderr.write('DESKPULSE_AGENT_TOKEN is not set; refusing to start.\n');
  process.exit(EXIT_NO_TOKEN);
}

startAgent({ token })
  .then(({ port }) => {
    process.stdout.write(
      `${JSON.stringify({ type: 'deskpulse-agent-ready', port, pid: process.pid, version: '0.1.0' })}\n`,
    );
  })
  .catch((error: unknown) => {
    process.stderr.write(`agent failed to start: ${String(error)}\n`);
    process.exit(71); // EX_OSERR — listen/bind failure
  });
