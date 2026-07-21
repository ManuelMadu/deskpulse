import { describe, expect, it } from 'vitest';

import { APP_BUNDLE_ID, WINDOW_DEFAULTS, isValidBundleId } from './config.js';

describe('desktop app config', () => {
  it('has a valid reverse-DNS bundle identifier', () => {
    expect(isValidBundleId(APP_BUNDLE_ID)).toBe(true);
  });

  it('rejects malformed bundle identifiers', () => {
    expect(isValidBundleId('no-dots')).toBe(false);
    expect(isValidBundleId('trailing.dot.')).toBe(false);
  });

  it('window minimums never exceed defaults (PDD §12)', () => {
    expect(WINDOW_DEFAULTS.minWidth).toBeLessThanOrEqual(WINDOW_DEFAULTS.width);
    expect(WINDOW_DEFAULTS.minHeight).toBeLessThanOrEqual(WINDOW_DEFAULTS.height);
  });
});
