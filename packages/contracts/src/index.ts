/**
 * @deskpulse/contracts — single source of truth for every cross-process shape:
 * HTTP request/response bodies, SSE event payloads, IPC payloads, the error
 * envelope, and persisted-file schemas. Populated ticket by ticket (DP-4+).
 *
 * This package must stay runtime-pure: zod is its only dependency, and it may
 * never import Electron or Node built-ins (lint + dependency-cruiser enforced).
 */

export const CONTRACTS_VERSION = '0.1.0' as const;

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
} as const;

export type Limits = typeof LIMITS;
