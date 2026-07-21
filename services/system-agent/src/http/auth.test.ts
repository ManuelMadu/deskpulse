import { describe, expect, it } from 'vitest';

import { createTokenVerifier } from './auth.js';

describe('token verifier', () => {
  const verifier = createTokenVerifier('a'.repeat(64));

  it('accepts the exact token', () => {
    expect(verifier.verify(`Bearer ${'a'.repeat(64)}`)).toBe('ok');
  });

  it('reports a missing header as missing', () => {
    expect(verifier.verify(undefined)).toBe('missing');
  });

  it('reports non-Bearer schemes as missing', () => {
    expect(verifier.verify(`Basic ${'a'.repeat(64)}`)).toBe('missing');
    expect(verifier.verify('Bearer')).toBe('missing');
    expect(verifier.verify('Bearer ')).toBe('missing');
  });

  it('rejects wrong tokens of any length as invalid', () => {
    expect(verifier.verify(`Bearer ${'b'.repeat(64)}`)).toBe('invalid');
    expect(verifier.verify('Bearer short')).toBe('invalid');
    expect(verifier.verify(`Bearer ${'a'.repeat(63)}x`)).toBe('invalid');
    expect(verifier.verify(`Bearer ${'a'.repeat(65)}`)).toBe('invalid');
  });

  it('refuses to be constructed with an empty token', () => {
    expect(() => createTokenVerifier('')).toThrow();
  });
});
