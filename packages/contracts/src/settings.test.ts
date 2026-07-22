import { describe, expect, it } from 'vitest';

import { appSettingsSchema, setLaunchAtLoginInputSchema } from './settings.js';

describe('appSettingsSchema', () => {
  it('round-trips a valid settings object', () => {
    expect(appSettingsSchema.parse({ launchAtLogin: true })).toEqual({ launchAtLogin: true });
  });

  it('rejects unknown fields and wrong types', () => {
    expect(appSettingsSchema.safeParse({ launchAtLogin: true, extra: 1 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ launchAtLogin: 'yes' }).success).toBe(false);
    expect(appSettingsSchema.safeParse({}).success).toBe(false);
  });
});

describe('setLaunchAtLoginInputSchema', () => {
  it('requires exactly an enabled boolean', () => {
    expect(setLaunchAtLoginInputSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(setLaunchAtLoginInputSchema.safeParse({ enabled: 1 }).success).toBe(false);
    expect(
      setLaunchAtLoginInputSchema.safeParse({ enabled: true, openAsHidden: true }).success,
    ).toBe(false);
  });
});
