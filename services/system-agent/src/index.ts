/**
 * Agent entry point. DP-5/DP-6 replace this with the real HTTP bootstrap
 * (bind 127.0.0.1:0, bearer auth, stdout readiness handshake, SIGTERM handling).
 * For DP-1 it only proves the esbuild bundle starts and exits cleanly.
 */
import { CONTRACTS_VERSION } from '@deskpulse/contracts';

export const AGENT_NAME = 'deskpulse-system-agent';

export function agentIdentity(): { name: string; contractsVersion: string } {
  return { name: AGENT_NAME, contractsVersion: CONTRACTS_VERSION };
}
