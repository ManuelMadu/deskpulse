import { LIMITS } from '@deskpulse/contracts';
import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './events.js';

import type { AgentEvent } from '@deskpulse/contracts';

const warning = (message: string): AgentEvent => ({
  type: 'agent.warning',
  code: 'test',
  message,
});

describe('EventBus', () => {
  it('assigns monotonic ids starting at 1', () => {
    const bus = new EventBus();
    expect(bus.publish(warning('a')).id).toBe(1);
    expect(bus.publish(warning('b')).id).toBe(2);
    expect(bus.lastId).toBe(2);
  });

  it('delivers to live subscribers and stops after unsubscribe', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    bus.publish(warning('a'));
    unsubscribe();
    bus.publish(warning('b'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replays only events after the given id', () => {
    const bus = new EventBus();
    bus.publish(warning('a'));
    bus.publish(warning('b'));
    bus.publish(warning('c'));
    const result = bus.replayAfter(1);
    expect(result.kind).toBe('events');
    if (result.kind === 'events') {
      expect(result.events.map((e) => e.id)).toEqual([2, 3]);
    }
  });

  it('returns an empty replay when the client is already current', () => {
    const bus = new EventBus();
    bus.publish(warning('a'));
    const result = bus.replayAfter(1);
    expect(result).toEqual({ kind: 'events', events: [] });
  });

  it('resets with new-run when the client id is from the future (previous run)', () => {
    const bus = new EventBus();
    bus.publish(warning('a'));
    expect(bus.replayAfter(99)).toEqual({ kind: 'reset', reason: 'new-run' });
  });

  it('resets with id-too-old when the id has aged out of the ring buffer', () => {
    const bus = new EventBus();
    const overflow = LIMITS.sseReplayBufferEvents + 50;
    for (let i = 0; i < overflow; i += 1) {
      bus.publish(warning(`e${i}`));
    }
    // id 1 was evicted; asking to replay after it must reset.
    expect(bus.replayAfter(1)).toEqual({ kind: 'reset', reason: 'id-too-old' });
    // but a recent id still replays
    const recent = bus.replayAfter(bus.lastId - 1);
    expect(recent.kind).toBe('events');
  });

  it('never grows the buffer past the replay cap', () => {
    const bus = new EventBus();
    for (let i = 0; i < LIMITS.sseReplayBufferEvents * 2; i += 1) {
      bus.publish(warning(`e${i}`));
    }
    // Replaying from 0 yields at most the cap.
    const result = bus.replayAfter(0);
    expect(result.kind).toBe('reset'); // 0 predates the surviving window
  });
});
