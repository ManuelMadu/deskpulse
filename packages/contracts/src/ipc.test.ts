import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, navigationTargetSchema } from './ipc.js';

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
