import { describe, expect, it } from 'vitest';

import { startWatchRequestSchema, watchCreatedSchema } from './watch.js';

describe('POST /watch request schema', () => {
  it('applies documented defaults', () => {
    expect(startWatchRequestSchema.parse({ path: '/var/log/system.log' })).toEqual({
      path: '/var/log/system.log',
      fromEnd: true,
      encoding: 'utf8',
    });
  });

  it('rejects relative paths, empty paths, bad encodings, unknown fields', () => {
    for (const bad of [
      { path: 'relative/app.log' },
      { path: '' },
      { path: '/x', encoding: 'utf16' },
      { path: '/x', follow: true },
    ]) {
      expect(startWatchRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('watch created schema', () => {
  it('accepts the documented shape (PDD §20)', () => {
    expect(
      watchCreatedSchema.safeParse({
        id: '018f4e2a-7c3b-7d90-b1a4-9e8d2c5f6a71',
        path: '/Users/me/Library/Logs/myapp/app.log',
        realPath: '/Users/me/Library/Logs/myapp/app.log',
        startOffset: 10485760,
        fileSizeBytes: 10485760,
      }).success,
    ).toBe(true);
  });

  it('rejects non-uuid ids', () => {
    expect(
      watchCreatedSchema.safeParse({
        id: 'watch-1',
        path: '/x',
        realPath: '/x',
        startOffset: 0,
        fileSizeBytes: 0,
      }).success,
    ).toBe(false);
  });
});
