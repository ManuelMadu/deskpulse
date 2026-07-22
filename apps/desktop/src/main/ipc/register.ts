import {
  DeskPulseError,
  ERROR_CODES,
  IPC_CHANNELS,
  ipcErr,
  ipcOk,
  processQuerySchema,
  processesResponseSchema,
  systemSummarySchema,
} from '@deskpulse/contracts';
import { ipcMain } from 'electron';
import { z } from 'zod';

import {
  handleRecentFiles,
  handleSelectFile,
  handleStartWatch,
  handleStopWatch,
  logsInputSchemas,
} from './logs.js';
import {
  handleAddMonitor,
  handleListMonitors,
  handleRemoveMonitor,
  handleUpdateMonitor,
  monitorsInputSchemas,
} from './monitors.js';
import { isTrustedSenderUrl } from './sender-check.js';
import { handleGetSettings, handleSetLaunchAtLogin, settingsInputSchemas } from './settings.js';

import type { AgentClient } from '../agent-client.js';
import type { AgentSupervisor } from '../agent-supervisor.js';
import type { PathTokenRegistry } from '../path-tokens.js';
import type { LaunchAtLoginController } from '../platform/launch-at-login.js';
import type { AgentStatus, IpcResult } from '@deskpulse/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';

/**
 * The one ipcMain.handle pattern (PDD §16/§17): verify sender → validate
 * input (main-side validation is authoritative) → call the service → return
 * IpcResult. Handlers never leak raw exceptions; everything crosses as the
 * structured envelope.
 */
function handle<In, Out>(
  channel: string,
  devServerUrl: string | undefined,
  inputSchema: ZodType<In>,
  run: (input: In) => Promise<Out> | Out,
): void {
  ipcMain.handle(
    channel,
    async (event: IpcMainInvokeEvent, rawInput: unknown): Promise<IpcResult<Out>> => {
      if (!isTrustedSenderUrl(event.senderFrame?.url, { devServerUrl })) {
        return ipcErr({
          code: ERROR_CODES.AUTH_INVALID,
          message: 'IPC request from an untrusted sender.',
          retryable: false,
        });
      }
      const input = inputSchema.safeParse(rawInput);
      if (!input.success) {
        return ipcErr({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid IPC request payload.',
          details: {
            issues: input.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
          retryable: false,
        });
      }
      try {
        return ipcOk(await run(input.data));
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
    },
  );
}

/** Channels that carry no payload must receive none (strictness everywhere). */
const noInput = z.undefined();

export function registerIpcHandlers(deps: {
  supervisor: AgentSupervisor;
  client: AgentClient;
  tokens: PathTokenRegistry;
  launchAtLogin: LaunchAtLoginController;
  defaultLogLocations: string[];
  devServerUrl: string | undefined;
}): void {
  const logsDeps = {
    client: deps.client,
    tokens: deps.tokens,
    defaultLogLocations: deps.defaultLogLocations,
  };

  handle(IPC_CHANNELS.agentGetStatus, deps.devServerUrl, noInput, (): AgentStatus => {
    const handle = deps.supervisor.currentHandle;
    const status: AgentStatus = { state: deps.supervisor.state };
    if (handle) {
      status.pid = handle.pid;
      status.version = handle.version;
    }
    return status;
  });

  handle(IPC_CHANNELS.systemGetSummary, deps.devServerUrl, noInput, () =>
    deps.client.get('/system', systemSummarySchema),
  );

  handle(IPC_CHANNELS.systemGetProcesses, deps.devServerUrl, processQuerySchema, (query) =>
    deps.client.get(
      `/processes?limit=${query.limit}&sortBy=${query.sortBy}`,
      processesResponseSchema,
    ),
  );

  handle(IPC_CHANNELS.logsSelectFile, deps.devServerUrl, noInput, handleSelectFile(logsDeps));
  handle(IPC_CHANNELS.logsRecentFiles, deps.devServerUrl, noInput, handleRecentFiles(logsDeps));
  handle(
    IPC_CHANNELS.logsStartWatch,
    deps.devServerUrl,
    logsInputSchemas.startWatch,
    handleStartWatch(logsDeps),
  );
  handle(
    IPC_CHANNELS.logsStopWatch,
    deps.devServerUrl,
    logsInputSchemas.stopWatch,
    handleStopWatch(logsDeps),
  );

  handle(IPC_CHANNELS.monitorsList, deps.devServerUrl, noInput, handleListMonitors(deps.client));
  handle(
    IPC_CHANNELS.monitorsAdd,
    deps.devServerUrl,
    monitorsInputSchemas.add,
    handleAddMonitor(deps.client),
  );
  handle(
    IPC_CHANNELS.monitorsUpdate,
    deps.devServerUrl,
    monitorsInputSchemas.update,
    handleUpdateMonitor(deps.client),
  );
  handle(
    IPC_CHANNELS.monitorsRemove,
    deps.devServerUrl,
    monitorsInputSchemas.remove,
    handleRemoveMonitor(deps.client),
  );

  handle(
    IPC_CHANNELS.settingsGet,
    deps.devServerUrl,
    noInput,
    handleGetSettings(deps.launchAtLogin),
  );
  handle(
    IPC_CHANNELS.settingsSetLaunchAtLogin,
    deps.devServerUrl,
    settingsInputSchemas.setLaunchAtLogin,
    handleSetLaunchAtLogin(deps.launchAtLogin),
  );
}
