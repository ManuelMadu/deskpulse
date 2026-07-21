import {
  DeskPulseError,
  ERROR_CODES,
  IPC_CHANNELS,
  ipcErr,
  ipcOk,
  systemSummarySchema,
} from '@deskpulse/contracts';
import { ipcMain } from 'electron';

import { isTrustedSenderUrl } from './sender-check.js';

import type { AgentClient } from '../agent-client.js';
import type { AgentSupervisor } from '../agent-supervisor.js';
import type { AgentStatus, IpcResult } from '@deskpulse/contracts';
import type { IpcMainInvokeEvent } from 'electron';

/**
 * The one ipcMain.handle pattern (PDD §16/§17): verify sender → validate
 * input → call the service → return IpcResult. Handlers never leak raw
 * exceptions; everything crosses as the structured envelope.
 */
function handle<T>(
  channel: string,
  devServerUrl: string | undefined,
  run: () => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent): Promise<IpcResult<T>> => {
    if (!isTrustedSenderUrl(event.senderFrame?.url, { devServerUrl })) {
      return ipcErr({
        code: ERROR_CODES.AUTH_INVALID,
        message: 'IPC request from an untrusted sender.',
        retryable: false,
      });
    }
    try {
      return ipcOk(await run());
    } catch (error) {
      if (error instanceof DeskPulseError) {
        return ipcErr(error.toShape());
      }
      return ipcErr({
        code: ERROR_CODES.INTERNAL,
        message: 'Unexpected error handling the request.',
        retryable: false,
      });
    }
  });
}

export function registerIpcHandlers(deps: {
  supervisor: AgentSupervisor;
  client: AgentClient;
  devServerUrl: string | undefined;
}): void {
  handle<AgentStatus>(IPC_CHANNELS.agentGetStatus, deps.devServerUrl, () => {
    const handle = deps.supervisor.currentHandle;
    const status: AgentStatus = { state: deps.supervisor.state };
    if (handle) {
      status.pid = handle.pid;
      status.version = handle.version;
    }
    return status;
  });

  handle(IPC_CHANNELS.systemGetSummary, deps.devServerUrl, () =>
    deps.client.get('/system', systemSummarySchema),
  );
}
