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
} as const;

export type Limits = typeof LIMITS;
