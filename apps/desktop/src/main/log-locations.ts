import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Default log-picker starting locations (PDD §24, §29 ShellPlatformAdapter).
 * Existence-checked so the dialog never opens on a missing directory. Only
 * darwin is implemented for the MVP; other platforms arrive in Phase W.
 */
export function defaultLogLocations(): string[] {
  if (process.platform !== 'darwin') {
    return [homedir()];
  }
  const candidates = [
    join(homedir(), 'Library', 'Logs'),
    '/var/log',
    join(homedir(), 'Library', 'Application Support'),
  ];
  const present = candidates.filter((path) => existsSync(path));
  return present.length > 0 ? present : [homedir()];
}
