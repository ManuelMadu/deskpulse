/** Hard limits shared by agent, main, and renderer (PDD FR-7/FR-8, §20, §21). */
export const LIMITS = {
  maxLogWatches: 5,
  maxMonitors: 20,
  maxLineLengthBytes: 32 * 1024,
  maxRequestBodyBytes: 64 * 1024,
  maxLogEntriesPerSecondPerWatch: 500,
  rendererLogRingBufferLines: 5_000,
  sseReplayBufferEvents: 500,
  maxSseConnections: 2,
  /** GET /processes */
  processQueryLimitMin: 1,
  processQueryLimitMax: 50,
  processQueryLimitDefault: 20,
  /** Log tailing + SSE (PDD §21, §24) */
  logBatchMaxLines: 50,
  logBatchFlushMs: 100,
  logBackfillMaxBytes: 1024 * 1024,
  logDeletedPollMs: 2_000,
  logDeletedRecreationWindowMs: 5 * 60_000,
  sseHeartbeatMs: 15_000,
  sseStalenessMs: 45_000,
  sseDropThresholdBytes: 2 * 1024 * 1024,
  sseCloseThresholdBytes: 8 * 1024 * 1024,
} as const;

export type Limits = typeof LIMITS;
