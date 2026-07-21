import { LIMITS } from '@deskpulse/contracts';

import type { AgentEvent } from '@deskpulse/contracts';

export interface PublishedEvent {
  /** Monotonic per-agent-run integer; the SSE `id:` field (PDD §21). */
  id: number;
  event: AgentEvent;
}

export type EventListener = (published: PublishedEvent) => void;

export type ReplayResult =
  | { kind: 'events'; events: PublishedEvent[] }
  | { kind: 'reset'; reason: 'id-too-old' | 'new-run' };

/**
 * Central event bus: every subsystem publishes typed events; the SSE
 * endpoint subscribes and replays from a bounded ring buffer on reconnect
 * (PDD §19, §21). Ids restart at 1 for each agent process — a Last-Event-ID
 * from a previous run is answered with stream.reset (new-run).
 */
export class EventBus {
  private nextId = 1;
  private readonly buffer: PublishedEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  publish(event: AgentEvent): PublishedEvent {
    const published: PublishedEvent = { id: this.nextId, event };
    this.nextId += 1;
    this.buffer.push(published);
    if (this.buffer.length > LIMITS.sseReplayBufferEvents) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      listener(published);
    }
    return published;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  replayAfter(lastEventId: number): ReplayResult {
    if (lastEventId >= this.nextId) {
      // The client saw ids this run never issued — a previous agent run.
      return { kind: 'reset', reason: 'new-run' };
    }
    const oldest = this.buffer[0];
    if (oldest === undefined) {
      // Nothing buffered: fine if the client is current, reset otherwise.
      return lastEventId === this.lastId
        ? { kind: 'events', events: [] }
        : { kind: 'reset', reason: 'id-too-old' };
    }
    if (lastEventId < oldest.id - 1) {
      return { kind: 'reset', reason: 'id-too-old' };
    }
    return { kind: 'events', events: this.buffer.filter((e) => e.id > lastEventId) };
  }
}
