import { z } from 'zod';

/**
 * Diagnostic export contracts (PDD §20/§27, FR-21…23). Main kicks off an
 * async, single-flight bundle build; progress arrives as `diagnostics.progress`
 * SSE events and the finished ZIP is moved to ~/Downloads by Main.
 *
 * Note (resolved divergence from §20): the main-process log is passed as a
 * temp-file *path* Main stages, not as base64 in the body — a 5 MiB base64 blob
 * would blow the agent's 64 KiB request-body cap, and a neutral temp file keeps
 * the process-ownership boundary intact (the agent never reads Electron paths).
 */

/** Max user-selected extra logs, matching the 5-watch/attention ceiling (§27). */
export const MAX_EXTRA_LOG_PATHS = 10;

export const exportRequestSchema = z.strictObject({
  /** Include per-monitor recent probe history in monitors.json. */
  includeHealthHistory: z.boolean().default(true),
  /** Redact secrets from DeskPulse's own logs + health history (FR-23). */
  redactAgentLogs: z.boolean().default(true),
  /** Absolute paths of user-selected logs, included verbatim (unredacted). */
  extraLogPaths: z.array(z.string().min(1)).max(MAX_EXTRA_LOG_PATHS).default([]),
  /** Optional temp file (staged by Main) holding the main-process log tail. */
  mainLogPath: z.string().min(1).optional(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const exportStartedSchema = z.strictObject({
  exportId: z.uuid(),
  /** Absolute path of the ZIP being built in the agent's temp staging dir. */
  stagingPath: z.string().min(1),
});
export type ExportStarted = z.infer<typeof exportStartedSchema>;
