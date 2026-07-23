import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { finalizeExport } from './diagnostics.js';

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'deskpulse-finalize-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('finalizeExport', () => {
  it('moves the staging ZIP to Downloads with a timestamped name and clears staging', async () => {
    const staging = join(work, 'deskpulse-export-abc');
    mkdirSync(staging);
    const zip = join(staging, 'bundle.zip');
    writeFileSync(zip, 'ZIPDATA');
    const downloads = join(work, 'Downloads');
    mkdirSync(downloads);

    const dest = await finalizeExport(zip, downloads, new Date('2026-07-23T09:08:07'));

    expect(dest).toBe(join(downloads, 'deskpulse-diagnostics-20260723-090807.zip'));
    expect(readFileSync(dest, 'utf8')).toBe('ZIPDATA');
    // The staging directory is removed entirely.
    expect(existsSync(dirname(zip))).toBe(false);
  });
});
