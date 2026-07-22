import type { AgentEvent, MonitorState, MonitorWithStatus } from '@deskpulse/contracts';

/**
 * Main-side aggregate health, distilled from the same agent event stream the
 * renderer consumes (PDD §13/§16). It answers one question for the tray and
 * notifications: is everything nominal, is something degraded, or is the agent
 * itself down? Pure and Electron-free so the derivation is unit-tested.
 *
 * - agent down  → the supervisor has no live agent (highest priority).
 * - degraded    → ≥ 1 monitor unhealthy, or ≥ 1 watched log in an error state.
 * - nominal     → everything else.
 */

export type TrayHealth = 'nominal' | 'degraded' | 'agent-down';

export interface MonitorLine {
  id: string;
  name: string;
  state: MonitorState;
}

export interface HealthSnapshot {
  health: TrayHealth;
  agentUp: boolean;
  /** Monitors, unhealthy first, for the tray's per-monitor summary. */
  monitors: MonitorLine[];
  unhealthyCount: number;
  erroredWatchCount: number;
}

const STATE_RANK: Record<MonitorState, number> = { unhealthy: 0, unknown: 1, healthy: 2 };

export class HealthState {
  private agentUp = false;
  private readonly monitors = new Map<string, MonitorLine>();
  private readonly erroredWatches = new Set<string>();
  private last: HealthSnapshot = this.compute();

  /** Feed one forwarded agent event; returns true if the snapshot changed. */
  ingest(event: AgentEvent): boolean {
    switch (event.type) {
      case 'agent.status':
        this.agentUp = event.status === 'ready';
        break;
      case 'monitor.unhealthy':
        this.setMonitor(event.monitorId, event.name, 'unhealthy');
        break;
      case 'monitor.recovered':
        this.setMonitor(event.monitorId, event.name, 'healthy');
        break;
      case 'log.error':
        this.erroredWatches.add(event.watchId);
        break;
      case 'log.entry':
      case 'log.rotated':
        // Lines flowing again (or a clean rotation) clears a prior error.
        this.erroredWatches.delete(event.watchId);
        break;
      case 'log.deleted':
        this.erroredWatches.delete(event.watchId);
        break;
      default:
        break;
    }
    return this.recompute();
  }

  /** The supervisor is the source of truth for whether an agent is alive. */
  setAgentUp(up: boolean): boolean {
    this.agentUp = up;
    return this.recompute();
  }

  /** Reconcile the monitor set against an authoritative /monitors snapshot. */
  hydrateMonitors(list: readonly MonitorWithStatus[]): boolean {
    this.monitors.clear();
    for (const monitor of list) {
      this.monitors.set(monitor.id, {
        id: monitor.id,
        name: monitor.name,
        state: monitor.state,
      });
    }
    return this.recompute();
  }

  /** Drop watches that no longer exist (all stopped) so they can't linger. */
  setActiveWatches(watchIds: readonly string[]): boolean {
    const live = new Set(watchIds);
    for (const id of this.erroredWatches) {
      if (!live.has(id)) {
        this.erroredWatches.delete(id);
      }
    }
    return this.recompute();
  }

  snapshot(): HealthSnapshot {
    return this.last;
  }

  private setMonitor(id: string, name: string, state: MonitorState): void {
    this.monitors.set(id, { id, name, state });
  }

  private recompute(): boolean {
    const next = this.compute();
    if (snapshotsEqual(this.last, next)) {
      return false;
    }
    this.last = next;
    return true;
  }

  private compute(): HealthSnapshot {
    const monitors = [...this.monitors.values()].sort(
      (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name),
    );
    const unhealthyCount = monitors.filter((m) => m.state === 'unhealthy').length;
    const erroredWatchCount = this.erroredWatches.size;
    const health: TrayHealth = !this.agentUp
      ? 'agent-down'
      : unhealthyCount > 0 || erroredWatchCount > 0
        ? 'degraded'
        : 'nominal';
    return { health, agentUp: this.agentUp, monitors, unhealthyCount, erroredWatchCount };
  }
}

function snapshotsEqual(a: HealthSnapshot, b: HealthSnapshot): boolean {
  if (
    a.health !== b.health ||
    a.agentUp !== b.agentUp ||
    a.unhealthyCount !== b.unhealthyCount ||
    a.erroredWatchCount !== b.erroredWatchCount ||
    a.monitors.length !== b.monitors.length
  ) {
    return false;
  }
  return a.monitors.every((m, i) => {
    const other = b.monitors[i]!;
    return m.id === other.id && m.name === other.name && m.state === other.state;
  });
}
