import { realpath, stat } from 'node:fs/promises';

import { dialog } from 'electron';

import type { PathTokenRegistry } from './path-tokens.js';
import type { SelectedFile } from '@deskpulse/contracts';

/**
 * Native log-file picker (PDD §16, FR-4). A path only ever enters the system
 * through this dialog — the renderer cannot submit a typed path. The chosen
 * path is realpath-resolved and handed back as an opaque token.
 */
export async function selectLogFile(
  registry: PathTokenRegistry,
  defaultLocations: string[],
): Promise<SelectedFile | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open log file',
    properties: ['openFile', 'showHiddenFiles'],
    ...(defaultLocations[0] !== undefined ? { defaultPath: defaultLocations[0] } : {}),
  });
  const chosen = result.filePaths[0];
  if (result.canceled || chosen === undefined) {
    return null;
  }

  const resolved = await realpath(chosen);
  const info = await stat(resolved);
  const { pathToken, displayPath } = registry.register(resolved);
  return { pathToken, displayPath, sizeBytes: info.size };
}
