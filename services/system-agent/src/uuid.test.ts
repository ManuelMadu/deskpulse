import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  it('produces RFC-9562 v7 uuids that satisfy the contract validator', () => {
    const id = uuidv7();
    expect(z.uuid().safeParse(id).success).toBe(true);
    expect(id[14]).toBe('7'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant
  });

  it('orders lexicographically with time', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it('never collides across a burst at the same millisecond', () => {
    const now = Date.now();
    const ids = new Set(Array.from({ length: 1_000 }, () => uuidv7(now)));
    expect(ids.size).toBe(1_000);
  });
});
