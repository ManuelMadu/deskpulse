import { describe, expect, it } from 'vitest';

import { APP_BUNDLE_ID, isValidBundleId } from './index.js';

describe('desktop workspace', () => {
  it('has a valid reverse-DNS bundle identifier', () => {
    expect(isValidBundleId(APP_BUNDLE_ID)).toBe(true);
  });

  it('rejects malformed bundle identifiers', () => {
    expect(isValidBundleId('no-dots')).toBe(false);
    expect(isValidBundleId('trailing.dot.')).toBe(false);
  });
});
