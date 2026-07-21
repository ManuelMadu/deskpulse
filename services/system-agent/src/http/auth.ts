import { createHash, timingSafeEqual } from 'node:crypto';

export type AuthResult = 'ok' | 'missing' | 'invalid';

/**
 * Bearer-token verifier. The expected token is hashed once at construction;
 * every candidate is hashed to the same fixed length so timingSafeEqual can
 * run regardless of the attacker-supplied length (PDD §20, §30).
 */
export interface TokenVerifier {
  verify(authorizationHeader: string | undefined): AuthResult;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function createTokenVerifier(expectedToken: string): TokenVerifier {
  if (expectedToken.length === 0) {
    throw new Error('expected token must be non-empty');
  }
  const expectedHash = sha256(expectedToken);

  return {
    verify(authorizationHeader) {
      if (authorizationHeader === undefined) {
        return 'missing';
      }
      const match = /^Bearer (.+)$/.exec(authorizationHeader);
      if (!match || match[1] === undefined) {
        return 'missing';
      }
      return timingSafeEqual(sha256(match[1]), expectedHash) ? 'ok' : 'invalid';
    },
  };
}
