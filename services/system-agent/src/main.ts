/**
 * Executable entry bundled to dist/agent.cjs. DP-5/DP-6 replace this with the
 * real bootstrap: bind 127.0.0.1:0, bearer auth from DESKPULSE_AGENT_TOKEN,
 * stdout readiness handshake, SIGTERM handling.
 */
import { agentIdentity } from './index.js';

process.stdout.write(
  `${JSON.stringify({ type: 'deskpulse-agent-placeholder', pid: process.pid, ...agentIdentity() })}\n`,
);
