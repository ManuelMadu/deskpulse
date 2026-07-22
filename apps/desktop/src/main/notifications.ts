import { NotificationPolicy } from './notification-policy.js';

import type { NotificationRequest } from './notification-policy.js';
import type { AgentEvent } from '@deskpulse/contracts';

/**
 * Native monitor notifications (PDD §13/§25). Driven by the Main-side agent
 * event stream — never the renderer — so a monitor going unhealthy or
 * recovering taps the user on the shoulder exactly once (after
 * failureThreshold fails, since the agent only emits the transition then).
 * Bursts coalesce via NotificationPolicy. Clicking a banner routes to the
 * Monitors screen.
 *
 * The actual banner presentation is injected (Presenter) so this wiring is
 * unit-tested without Electron; main.ts supplies the real Notification-backed
 * presenter.
 */

export interface Presentation {
  /** Register the banner's click handler (raise window + show Monitors). */
  onClick: (handler: () => void) => void;
}

export type Presenter = (payload: { title: string; body: string }) => Presentation;

export interface MonitorNotifierOptions {
  present: Presenter;
  onActivate: () => void;
  coalesceWindowMs?: number | undefined;
  coalesceThreshold?: number | undefined;
}

/** Human-readable banner text for a notification request (pure, tested). */
export function messageFor(request: NotificationRequest): { title: string; body: string } {
  if (request.kind === 'single') {
    return request.transition.kind === 'unhealthy'
      ? { title: 'Monitor unhealthy', body: `${request.transition.name} stopped responding.` }
      : { title: 'Monitor recovered', body: `${request.transition.name} is healthy again.` };
  }
  const { unhealthy, recovered, total } = request;
  let body: string;
  if (recovered === 0) {
    body = `${unhealthy} monitors went unhealthy.`;
  } else if (unhealthy === 0) {
    body = `${recovered} monitors recovered.`;
  } else {
    body = `${unhealthy} unhealthy, ${recovered} recovered.`;
  }
  return { title: `${total} monitors changed state`, body };
}

export class MonitorNotifier {
  private readonly policy: NotificationPolicy;
  private readonly present: Presenter;
  private readonly onActivate: () => void;

  constructor(options: MonitorNotifierOptions) {
    this.present = options.present;
    this.onActivate = options.onActivate;
    this.policy = new NotificationPolicy({
      emit: (request) => this.show(request),
      coalesceWindowMs: options.coalesceWindowMs,
      coalesceThreshold: options.coalesceThreshold,
    });
  }

  /** Fold one forwarded agent event into the notification policy. */
  handleEvent(event: AgentEvent): void {
    if (event.type === 'monitor.unhealthy') {
      this.policy.record({ kind: 'unhealthy', monitorId: event.monitorId, name: event.name });
    } else if (event.type === 'monitor.recovered') {
      this.policy.record({ kind: 'recovered', monitorId: event.monitorId, name: event.name });
    }
  }

  dispose(): void {
    this.policy.dispose();
  }

  private show(request: NotificationRequest): void {
    const presentation = this.present(messageFor(request));
    presentation.onClick(() => this.onActivate());
  }
}
