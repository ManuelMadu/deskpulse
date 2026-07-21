import { z } from 'zod';

import { deskPulseErrorShapeSchema } from './error.js';

/**
 * SSE event payloads (PDD §21). One discriminated union on `type`; the agent
 * serializes `data` from these shapes and Main refuses any frame that fails
 * this parse. monitor.* and diagnostics.* variants arrive with Phases 5/8.
 */

const isoDateTime = z.iso.datetime();

export const logEntrySchema = z.strictObject({
  /** One decoded line, ANSI stripped renderer-side, never rendered as HTML. */
  line: z.string(),
  /** Byte offset in the file just after this line. */
  offset: z.number().int().nonnegative(),
  at: isoDateTime,
});

export type LogEntry = z.infer<typeof logEntrySchema>;

export const logEntryEventSchema = z.strictObject({
  type: z.literal('log.entry'),
  watchId: z.uuid(),
  entries: z.array(logEntrySchema).min(1),
  /** Lines coalesced away by rate capping since the previous batch (FR-7). */
  dropped: z.number().int().nonnegative(),
  /** Lines longer than the 32 KiB cap, emitted truncated (§24). */
  truncatedLines: z.number().int().nonnegative(),
});

export const logRotatedEventSchema = z.strictObject({
  type: z.literal('log.rotated'),
  watchId: z.uuid(),
  previousInode: z.number().int().nonnegative(),
  newInode: z.number().int().nonnegative(),
  resumedAtOffset: z.number().int().nonnegative(),
});

export const logTruncatedEventSchema = z.strictObject({
  type: z.literal('log.truncated'),
  watchId: z.uuid(),
  previousSize: z.number().int().nonnegative(),
  newSize: z.number().int().nonnegative(),
});

export const logDeletedEventSchema = z.strictObject({
  type: z.literal('log.deleted'),
  watchId: z.uuid(),
  path: z.string().min(1),
});

export const logErrorEventSchema = z.strictObject({
  type: z.literal('log.error'),
  watchId: z.uuid(),
  error: deskPulseErrorShapeSchema,
});

export const agentWarningEventSchema = z.strictObject({
  type: z.literal('agent.warning'),
  code: z.string().min(1),
  message: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const agentStatusEventSchema = z.strictObject({
  type: z.literal('agent.status'),
  status: z.enum(['ready', 'stopping']),
  pid: z.number().int().positive(),
  version: z.string().min(1),
  /**
   * Fresh per agent process (PDD R5): Main discards events whose runId does
   * not match the run it is supervising, killing restart races by design.
   */
  runId: z.string().min(8),
});

export const streamResetEventSchema = z.strictObject({
  type: z.literal('stream.reset'),
  /** Why replay was impossible: id predates the buffer or a new agent run. */
  reason: z.enum(['id-too-old', 'new-run']),
});

export const agentEventSchema = z.discriminatedUnion('type', [
  logEntryEventSchema,
  logRotatedEventSchema,
  logTruncatedEventSchema,
  logDeletedEventSchema,
  logErrorEventSchema,
  agentWarningEventSchema,
  agentStatusEventSchema,
  streamResetEventSchema,
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = AgentEvent['type'];

/** Events that backpressure may drop; transition/status events never drop (§21). */
export const DROPPABLE_EVENT_TYPES: readonly AgentEventType[] = ['log.entry'];
