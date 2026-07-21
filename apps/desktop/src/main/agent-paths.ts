import path from 'node:path';

import { app } from 'electron';

/**
 * The single place that knows where the agent bundle lives (PDD R4):
 * packaged — Forge extraResource next to the app's resources;
 * dev — the system-agent workspace's build output.
 */
export function resolveAgentBundlePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'agent.cjs');
  }
  return path.join(app.getAppPath(), '..', '..', 'services', 'system-agent', 'dist', 'agent.cjs');
}
