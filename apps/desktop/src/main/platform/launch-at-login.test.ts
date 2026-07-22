import { describe, expect, it } from 'vitest';

import { LaunchAtLoginController } from './launch-at-login.js';

import type { LoginItemGateway, LoginItemState } from './launch-at-login.js';

function fakeGateway(initial: boolean): {
  gateway: LoginItemGateway;
  writes: { openAtLogin: boolean; openAsHidden: boolean }[];
} {
  let state: LoginItemState = {
    openAtLogin: initial,
    openAsHidden: false,
    wasOpenedAsHidden: false,
  };
  const writes: { openAtLogin: boolean; openAsHidden: boolean }[] = [];
  return {
    writes,
    gateway: {
      get: () => state,
      set: (settings) => {
        writes.push(settings);
        state = {
          ...state,
          openAtLogin: settings.openAtLogin,
          openAsHidden: settings.openAsHidden,
        };
      },
    },
  };
}

describe('LaunchAtLoginController', () => {
  it('reads the current OS value', () => {
    expect(new LaunchAtLoginController(fakeGateway(true).gateway).isEnabled()).toBe(true);
    expect(new LaunchAtLoginController(fakeGateway(false).gateway).isEnabled()).toBe(false);
  });

  it('enables with openAsHidden and reports the read-back value', () => {
    const { gateway, writes } = fakeGateway(false);
    const controller = new LaunchAtLoginController(gateway);

    expect(controller.setEnabled(true)).toBe(true);
    expect(writes).toEqual([{ openAtLogin: true, openAsHidden: true }]);
    expect(controller.isEnabled()).toBe(true);
  });

  it('trusts the OS read-back over the requested value', () => {
    // A gateway that refuses to persist (e.g. MDM policy): the controller must
    // report what the OS actually stored, not what was asked for.
    const stubborn: LoginItemGateway = {
      get: () => ({ openAtLogin: false, openAsHidden: false, wasOpenedAsHidden: false }),
      set: () => undefined,
    };
    expect(new LaunchAtLoginController(stubborn).setEnabled(true)).toBe(false);
  });
});
