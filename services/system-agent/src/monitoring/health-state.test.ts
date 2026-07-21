import { describe, expect, it } from 'vitest';

import { MonitorStateMachine } from './health-state.js';

function feed(machine: MonitorStateMachine, results: boolean[]): void {
  results.forEach((ok, i) => machine.record(ok, i * 1000));
}

describe('MonitorStateMachine (FR-11 transition matrix)', () => {
  it('starts unknown and becomes healthy on the first ok', () => {
    const m = new MonitorStateMachine({ failureThreshold: 3, recoveryThreshold: 1 });
    expect(m.state).toBe('unknown');
    m.record(true, 0);
    expect(m.state).toBe('healthy');
  });

  it('goes unhealthy only after exactly failureThreshold consecutive fails', () => {
    const m = new MonitorStateMachine({ failureThreshold: 3, recoveryThreshold: 1 });
    m.record(false, 0);
    m.record(false, 1);
    expect(m.state).toBe('unknown'); // 2 fails: not yet
    const t = m.record(false, 2);
    expect(m.state).toBe('unhealthy');
    expect(t).toEqual({ kind: 'became-unhealthy', consecutiveFailures: 3 });
  });

  it('resets the failure count on any ok before the threshold', () => {
    const m = new MonitorStateMachine({ failureThreshold: 3, recoveryThreshold: 1 });
    feed(m, [false, false, true, false, false]);
    expect(m.state).toBe('healthy'); // the ok reset the streak
    expect(m.failures).toBe(2);
  });

  it('recovers only after exactly recoveryThreshold consecutive oks', () => {
    const m = new MonitorStateMachine({ failureThreshold: 1, recoveryThreshold: 2 });
    m.record(false, 0); // → unhealthy immediately (threshold 1)
    expect(m.state).toBe('unhealthy');
    m.record(true, 1000);
    expect(m.state).toBe('unhealthy'); // 1 ok: not yet
    const t = m.record(true, 2000);
    expect(m.state).toBe('healthy');
    expect(t.kind).toBe('became-healthy');
    if (t.kind === 'became-healthy') {
      expect(t.downFrom).toBe(0); // unhealthy since the first fail
    }
  });

  it('a fail during recovery resets the ok streak', () => {
    const m = new MonitorStateMachine({ failureThreshold: 1, recoveryThreshold: 3 });
    m.record(false, 0);
    feed(m, [true, true]);
    m.record(false, 3000); // resets ok streak
    feed(m, [true, true]);
    expect(m.state).toBe('unhealthy'); // only 2 oks since the reset
    m.record(true, 6000);
    expect(m.state).toBe('healthy'); // now 3
  });

  it('emits no transition while staying healthy or staying unhealthy', () => {
    const m = new MonitorStateMachine({ failureThreshold: 2, recoveryThreshold: 2 });
    expect(m.record(true, 0)).toEqual({ kind: 'none' }); // unknown→healthy is silent
    expect(m.record(true, 1)).toEqual({ kind: 'none' });
    m.record(false, 2);
    expect(m.record(false, 3).kind).toBe('became-unhealthy');
    expect(m.record(false, 4)).toEqual({ kind: 'none' }); // still unhealthy
  });

  it('reset returns to unknown and clears counters', () => {
    const m = new MonitorStateMachine({ failureThreshold: 1, recoveryThreshold: 1 });
    m.record(false, 0);
    expect(m.state).toBe('unhealthy');
    m.reset();
    expect(m.state).toBe('unknown');
    expect(m.failures).toBe(0);
  });

  it('unknown can go straight to unhealthy without ever being healthy', () => {
    const m = new MonitorStateMachine({ failureThreshold: 2, recoveryThreshold: 1 });
    m.record(false, 0);
    const t = m.record(false, 1);
    expect(m.state).toBe('unhealthy');
    expect(t.kind).toBe('became-unhealthy');
  });
});
