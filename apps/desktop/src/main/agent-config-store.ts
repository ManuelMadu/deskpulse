import type { MonitorConfigInput, MonitorPatch } from '@deskpulse/contracts';

/**
 * Main's in-memory record of the config it has pushed to the agent (PDD §14:
 * the agent is stateless across restarts; Main is the authoritative config
 * owner). After a crash the supervisor re-pushes everything here to the fresh
 * agent (PDD §28). Durable disk persistence lands in Phase 9; for now this
 * survives an agent restart but not an app restart.
 */

export interface WatchSpec {
  path: string;
  fromEnd: boolean;
  encoding: 'utf8';
}

export class AgentConfigStore {
  private readonly monitors = new Map<string, MonitorConfigInput>();
  private readonly watches = new Map<string, WatchSpec>();

  recordMonitor(id: string, config: MonitorConfigInput): void {
    this.monitors.set(id, config);
  }

  /** Merge a patch into a stored monitor config so a re-push stays accurate. */
  mergeMonitor(id: string, patch: MonitorPatch): void {
    const current = this.monitors.get(id);
    if (!current) {
      return;
    }
    const merged: MonitorConfigInput = { ...current };
    for (const key of Object.keys(patch) as (keyof MonitorPatch)[]) {
      const value = patch[key];
      if (value !== undefined) {
        // Each patch key maps to the same config key; only defined fields win.
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    this.monitors.set(id, merged);
  }

  removeMonitor(id: string): void {
    this.monitors.delete(id);
  }

  recordWatch(id: string, spec: WatchSpec): void {
    this.watches.set(id, spec);
  }

  removeWatch(id: string): void {
    this.watches.delete(id);
  }

  monitorEntries(): [string, MonitorConfigInput][] {
    return [...this.monitors.entries()];
  }

  watchEntries(): [string, WatchSpec][] {
    return [...this.watches.entries()];
  }

  resetMonitors(): void {
    this.monitors.clear();
  }

  resetWatches(): void {
    this.watches.clear();
  }
}
