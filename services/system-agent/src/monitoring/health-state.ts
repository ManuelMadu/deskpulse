import type { MonitorState } from '@deskpulse/contracts';

export interface Thresholds {
  failureThreshold: number;
  recoveryThreshold: number;
}

export type Transition =
  | { kind: 'none' }
  | { kind: 'became-unhealthy'; consecutiveFailures: number }
  | { kind: 'became-healthy'; downFrom: number };

/**
 * Pure per-monitor state machine (PDD §25, FR-11). Consecutive-result
 * thresholds gate every transition; `unknown` resolves on the first result.
 * No timers, no I/O — driven one probe result at a time so the transition
 * matrix is exhaustively unit-testable.
 */
export class MonitorStateMachine {
  private stateValue: MonitorState = 'unknown';
  private consecutiveFailures = 0;
  private consecutiveOks = 0;
  /** When the current unhealthy streak began (ms epoch); undefined if healthy. */
  private unhealthySince: number | undefined;

  constructor(private readonly thresholds: Thresholds) {}

  get state(): MonitorState {
    return this.stateValue;
  }

  get failures(): number {
    return this.consecutiveFailures;
  }

  /** Feed one probe outcome; returns whether a health transition occurred. */
  record(ok: boolean, atMs: number): Transition {
    if (ok) {
      this.consecutiveFailures = 0;
      this.consecutiveOks += 1;
    } else {
      this.consecutiveOks = 0;
      this.consecutiveFailures += 1;
    }

    if (this.stateValue === 'healthy' || this.stateValue === 'unknown') {
      if (!ok && this.consecutiveFailures >= this.thresholds.failureThreshold) {
        this.stateValue = 'unhealthy';
        this.unhealthySince = atMs;
        return { kind: 'became-unhealthy', consecutiveFailures: this.consecutiveFailures };
      }
      if (ok && this.stateValue === 'unknown') {
        this.stateValue = 'healthy';
      }
      return { kind: 'none' };
    }

    // Currently unhealthy: recover only after enough consecutive oks.
    if (ok && this.consecutiveOks >= this.thresholds.recoveryThreshold) {
      const downFrom = this.unhealthySince ?? atMs;
      this.stateValue = 'healthy';
      this.unhealthySince = undefined;
      return { kind: 'became-healthy', downFrom };
    }
    return { kind: 'none' };
  }

  /** Reset to `unknown` (used when url/method/expectedStatus changes, §20). */
  reset(): void {
    this.stateValue = 'unknown';
    this.consecutiveFailures = 0;
    this.consecutiveOks = 0;
    this.unhealthySince = undefined;
  }
}
