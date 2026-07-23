import { copyFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { exportStartedSchema } from '@deskpulse/contracts';

import type { AgentClient } from './agent-client.js';
import type { ExportStarted, StartExportInput } from '@deskpulse/contracts';

/**
 * Diagnostic-export orchestration on the Main side (PDD §20/§27). Main asks the
 * agent to build the bundle, then — on the `diagnostics.progress` done event —
 * moves the finished ZIP out of the agent's temp staging dir into ~/Downloads
 * and reveals it in Finder. Extra-log selection and the main-process log tail
 * are Main's to contribute; for now neither is wired (Main has no log file yet),
 * so the request carries just the renderer's toggles.
 */
export function handleStartExport(
  client: AgentClient,
): (input: StartExportInput) => Promise<ExportStarted> {
  return (input) =>
    client.post(
      '/diagnostics/export',
      {
        includeHealthHistory: input.includeHealthHistory,
        redactAgentLogs: input.redactAgentLogs,
        extraLogPaths: [],
      },
      exportStartedSchema,
    );
}

function timestamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Move a finished staging ZIP to ~/Downloads (atomic rename on the same volume,
 * copy+delete across volumes) and delete the staging dir. Returns the final
 * path. Pure of Electron so it is unit-testable; the caller supplies downloadsDir.
 */
export async function finalizeExport(
  stagingPath: string,
  downloadsDir: string,
  now: Date = new Date(),
): Promise<string> {
  const dest = join(downloadsDir, `deskpulse-diagnostics-${timestamp(now)}.zip`);
  try {
    await rename(stagingPath, dest);
  } catch {
    await copyFile(stagingPath, dest);
    await rm(stagingPath, { force: true });
  }
  await rm(dirname(stagingPath), { recursive: true, force: true });
  return dest;
}
