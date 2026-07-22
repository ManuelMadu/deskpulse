import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, navigationTargetSchema, reconcilePayloadSchema } from './ipc.js';

describe('navigationTargetSchema', () => {
  it('accepts every renderer screen', () => {
    for (const target of ['dashboard', 'logs', 'monitors'] as const) {
      expect(navigationTargetSchema.parse(target)).toBe(target);
    }
  });

  it('rejects unknown targets', () => {
    expect(navigationTargetSchema.safeParse('settings').success).toBe(false);
    expect(navigationTargetSchema.safeParse('').success).toBe(false);
  });

  it('exposes a dedicated Main→renderer navigation channel', () => {
    expect(IPC_CHANNELS.navigate).toBe('deskpulse:navigate');
  });
});

describe('reconcilePayloadSchema', () => {
  it('accepts a uuid→uuid watch remap', () => {
    const remap = {
      '11111111-1111-4111-8111-111111111111': '22222222-2222-4222-8222-222222222222',
    };
    expect(reconcilePayloadSchema.parse({ watchRemap: remap })).toEqual({ watchRemap: remap });
    expect(reconcilePayloadSchema.parse({ watchRemap: {} }).watchRemap).toEqual({});
  });

  it('rejects non-uuid ids and unknown fields', () => {
    expect(reconcilePayloadSchema.safeParse({ watchRemap: { a: 'b' } }).success).toBe(false);
    expect(reconcilePayloadSchema.safeParse({ watchRemap: {}, extra: 1 }).success).toBe(false);
  });

  it('exposes the reconcile and agent-restart channels', () => {
    expect(IPC_CHANNELS.reconcile).toBe('deskpulse:reconcile');
    expect(IPC_CHANNELS.agentRestart).toBe('deskpulse:agent:restart');
  });
});
