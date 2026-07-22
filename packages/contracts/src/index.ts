/**
 * @deskpulse/contracts — single source of truth for every cross-process shape:
 * HTTP request/response bodies, SSE event payloads, IPC payloads, the error
 * envelope, and persisted-file schemas. Populated ticket by ticket (DP-4+).
 *
 * This package must stay runtime-pure: zod is its only dependency, and it may
 * never import Electron or Node built-ins (lint + dependency-cruiser enforced).
 */

export const CONTRACTS_VERSION = '0.1.0' as const;

export { LIMITS, type Limits } from './limits.js';
export { ERROR_CODES, ERROR_HTTP_STATUS, type ErrorCode } from './error-codes.js';
export {
  DeskPulseError,
  deskPulseErrorShapeSchema,
  errorEnvelopeSchema,
  type DeskPulseErrorShape,
  type ErrorEnvelope,
} from './error.js';
export {
  healthResponseSchema,
  systemSummarySchema,
  type HealthResponse,
  type SystemSummary,
} from './http.js';
export {
  AGENT_EXIT_CODES,
  agentReadyHandshakeSchema,
  type AgentReadyHandshake,
} from './handshake.js';
export {
  processInfoSchema,
  processQuerySchema,
  processesResponseSchema,
  type ProcessInfo,
  type ProcessQuery,
  type ProcessesResponse,
} from './processes.js';
export {
  DROPPABLE_EVENT_TYPES,
  agentEventSchema,
  agentStatusEventSchema,
  logEntryEventSchema,
  monitorResultEventSchema,
  monitorUnhealthyEventSchema,
  monitorRecoveredEventSchema,
  streamResetEventSchema,
  type AgentEvent,
  type AgentEventType,
  type LogEntry,
} from './events.js';
export {
  expectedStatusSchema,
  isLoopbackUrl,
  monitorConfigInputSchema,
  monitorPatchSchema,
  monitorStateSchema,
  monitorWithStatusSchema,
  probeFailureReasonSchema,
  probeResultSchema,
  type ExpectedStatus,
  type MonitorConfigInput,
  type MonitorPatch,
  type MonitorState,
  type MonitorWithStatus,
  type ProbeFailureReason,
  type ProbeResult,
} from './monitors.js';
export {
  addMonitorInputSchema,
  removeMonitorInputSchema,
  updateMonitorInputSchema,
  type AddMonitorInput,
  type RemoveMonitorInput,
  type UpdateMonitorInput,
} from './monitors-ipc.js';
export {
  startWatchRequestSchema,
  watchCreatedSchema,
  type StartWatchRequest,
  type WatchCreated,
} from './watch.js';
export {
  recentFileSchema,
  selectedFileSchema,
  startLogWatchInputSchema,
  stopLogWatchInputSchema,
  watchHandleSchema,
  type RecentFile,
  type SelectedFile,
  type StartLogWatchInput,
  type StopLogWatchInput,
  type WatchHandle,
} from './logs-ipc.js';
export {
  IPC_CHANNELS,
  agentStatusSchema,
  ipcErr,
  ipcFailureSchema,
  ipcOk,
  navigationTargetSchema,
  type AgentStatus,
  type IpcChannel,
  type IpcResult,
  type NavigationTarget,
} from './ipc.js';
