import { describe, expect, it } from 'vitest';

import { PathTokenRegistry } from './path-tokens.js';

describe('PathTokenRegistry', () => {
  it('mints opaque tokens that resolve back to the real path', () => {
    const registry = new PathTokenRegistry();
    const { pathToken } = registry.register('/var/log/app.log');
    expect(pathToken).not.toContain('/');
    expect(registry.resolve(pathToken)).toBe('/var/log/app.log');
  });

  it('reuses one token per path', () => {
    const registry = new PathTokenRegistry();
    const a = registry.register('/var/log/app.log');
    const b = registry.register('/var/log/app.log');
    expect(a.pathToken).toBe(b.pathToken);
  });

  it('returns undefined for unknown tokens', () => {
    const registry = new PathTokenRegistry();
    expect(registry.resolve('made-up')).toBeUndefined();
  });

  it('keeps an MRU of the last 10, most-recent-first, deduped', () => {
    const registry = new PathTokenRegistry();
    for (let i = 0; i < 12; i += 1) {
      registry.register(`/logs/file-${i}.log`);
    }
    registry.register('/logs/file-3.log'); // re-touch moves it to front
    const recent = registry.recentFiles();
    expect(recent).toHaveLength(10);
    expect(recent[0]?.displayPath).toBe('file-3.log');
    // oldest entries (0, 1) evicted
    expect(recent.some((r) => r.displayPath === 'file-0.log')).toBe(false);
  });

  it('exposes only basenames in recent files, with resolvable tokens', () => {
    const registry = new PathTokenRegistry();
    registry.register('/Users/me/Library/Logs/myapp/app.log');
    const [recent] = registry.recentFiles();
    expect(recent?.displayPath).toBe('app.log');
    expect(registry.resolve(recent!.pathToken)).toBe('/Users/me/Library/Logs/myapp/app.log');
  });
});
