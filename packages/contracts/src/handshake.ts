import { z } from 'zod';

/**
 * The one JSON line the agent prints to stdout when ready (PDD §19). The
 * supervisor parses stdout line-wise against this schema; anything else on
 * stdout is logged and ignored.
 */
export const agentReadyHandshakeSchema = z.strictObject({
  type: z.literal('deskpulse-agent-ready'),
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().positive(),
  version: z.string().min(1),
});

export type AgentReadyHandshake = z.infer<typeof agentReadyHandshakeSchema>;

/** Agent exit codes the supervisor classifies (PDD §19, §28). */
export const AGENT_EXIT_CODES = {
  /** DESKPULSE_AGENT_TOKEN missing — programming/spawn bug (EX_CONFIG). */
  noToken: 78,
  /** listen/bind failure (EX_OSERR). */
  listenFailure: 71,
} as const;
