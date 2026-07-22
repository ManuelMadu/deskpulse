import {
  DeskPulseError,
  ERROR_CODES,
  startLogWatchInputSchema,
  stopLogWatchInputSchema,
  watchCreatedSchema,
} from '@deskpulse/contracts';

import { selectLogFile } from '../dialogs.js';

import type { AgentConfigStore } from '../agent-config-store.js';
import type { AgentClient } from '../agent-client.js';
import type { PathTokenRegistry } from '../path-tokens.js';
import type {
  RecentFile,
  SelectedFile,
  StartLogWatchInput,
  StopLogWatchInput,
  WatchHandle,
} from '@deskpulse/contracts';

export interface LogsDeps {
  client: AgentClient;
  tokens: PathTokenRegistry;
  store: AgentConfigStore;
  defaultLogLocations: string[];
}

/** Opens the native picker; the returned token is the only handle the UI gets. */
export function handleSelectFile(deps: LogsDeps): () => Promise<SelectedFile | null> {
  return () => selectLogFile(deps.tokens, deps.defaultLogLocations);
}

export function handleRecentFiles(deps: LogsDeps): () => RecentFile[] {
  return () => deps.tokens.recentFiles();
}

/** Resolves the token to a real path in Main, then calls the agent's POST /watch. */
export function handleStartWatch(
  deps: LogsDeps,
): (input: StartLogWatchInput) => Promise<WatchHandle> {
  return async (input) => {
    const realPath = deps.tokens.resolve(input.pathToken);
    if (realPath === undefined) {
      throw new DeskPulseError({
        code: ERROR_CODES.NOT_FOUND,
        message: 'That file selection has expired. Please choose the file again.',
        retryable: false,
      });
    }
    const spec = { path: realPath, fromEnd: input.fromEnd, encoding: 'utf8' as const };
    const created = await deps.client.post('/watch', spec, watchCreatedSchema);
    // Remember the watch so it can be re-issued to a restarted agent (§28).
    deps.store.recordWatch(created.id, spec);
    return {
      watchId: created.id,
      displayPath: created.path,
      startOffset: created.startOffset,
      fileSizeBytes: created.fileSizeBytes,
    };
  };
}

export function handleStopWatch(deps: LogsDeps): (input: StopLogWatchInput) => Promise<void> {
  return async (input) => {
    await deps.client.delete(`/watch/${input.watchId}`);
    deps.store.removeWatch(input.watchId);
  };
}

export const logsInputSchemas = {
  startWatch: startLogWatchInputSchema,
  stopWatch: stopLogWatchInputSchema,
};
