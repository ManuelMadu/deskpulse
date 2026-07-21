import { IPC_CHANNELS } from '@deskpulse/contracts';
import { BrowserWindow } from 'electron';

import type { AgentEvent } from '@deskpulse/contracts';

/**
 * Fans validated agent events (already parsed in Main by the SSE consumer)
 * out to every renderer over the single event channel (PDD §16). The renderer
 * subscribes through preload's onAgentEvent.
 */
export function forwardAgentEvent(event: AgentEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.event, event);
    }
  }
}
