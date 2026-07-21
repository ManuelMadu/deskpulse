import { describe, expect, it } from 'vitest';

import { isTrustedSenderUrl } from './sender-check.js';

describe('IPC sender verification (PDD §17)', () => {
  const dev = { devServerUrl: 'http://localhost:5173/' };
  const packaged = { devServerUrl: undefined };

  it('accepts the dev server origin in dev', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', dev)).toBe(true);
  });

  it('accepts file:// app documents when packaged', () => {
    expect(
      isTrustedSenderUrl('file:///Applications/DeskPulse.app/renderer/index.html', packaged),
    ).toBe(true);
  });

  it('rejects web origins, missing frames, and lookalike origins', () => {
    expect(isTrustedSenderUrl('https://evil.example/', dev)).toBe(false);
    expect(isTrustedSenderUrl('https://evil.example/', packaged)).toBe(false);
    expect(isTrustedSenderUrl(undefined, dev)).toBe(false);
    expect(isTrustedSenderUrl('', dev)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:51730/', dev)).toBe(false);
    // dev server origin must not be trusted once packaged
    expect(isTrustedSenderUrl('http://localhost:5173/index.html', packaged)).toBe(false);
  });
});
