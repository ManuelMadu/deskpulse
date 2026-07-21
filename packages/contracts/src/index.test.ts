import { describe, expect, it } from 'vitest';

import { CONTRACTS_VERSION, LIMITS } from './index.js';

describe('contracts package', () => {
  it('exposes a version', () => {
    expect(CONTRACTS_VERSION).toBe('0.1.0');
  });

  it('every limit is a bounded positive integer', () => {
    for (const [name, value] of Object.entries(LIMITS)) {
      expect(Number.isInteger(value), `${name} must be an integer`).toBe(true);
      expect(value, `${name} must be positive`).toBeGreaterThan(0);
    }
  });
});
