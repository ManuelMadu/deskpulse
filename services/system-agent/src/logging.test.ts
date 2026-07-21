import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LOG_FILE_NAME, createAgentLogging, rotateGenerations } from './logging.js';

let dir: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('log rotation', () => {
  it('shifts generations and drops the oldest', () => {
    dir = mkdtempSync(join(tmpdir(), 'deskpulse-log-'));
    const file = join(dir, LOG_FILE_NAME);
    writeFileSync(file, 'current');
    writeFileSync(`${file}.1`, 'gen1');
    writeFileSync(`${file}.2`, 'gen2');

    rotateGenerations(file, 3);

    expect(existsSync(file)).toBe(false); // current moved to .1
    expect(readFileSync(`${file}.1`, 'utf8')).toBe('current');
    expect(readFileSync(`${file}.2`, 'utf8')).toBe('gen1');
    // former .2 ("gen2") dropped — only N generations survive
  });

  it('rotates an oversized file at startup and keeps logging to a fresh file', () => {
    dir = mkdtempSync(join(tmpdir(), 'deskpulse-log-'));
    const file = join(dir, LOG_FILE_NAME);
    writeFileSync(file, 'x'.repeat(2048));

    const logging = createAgentLogging({ dir, maxBytes: 1024, generations: 3 });
    logging.logger.info({ subsystem: 'test' }, 'fresh line');
    logging.close();

    expect(readFileSync(`${file}.1`, 'utf8')).toBe('x'.repeat(2048));
    const fresh = readFileSync(file, 'utf8');
    expect(fresh).toContain('fresh line');
    expect(fresh).toContain('"proc":"agent"');
  });

  it('creates the log directory when missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'deskpulse-log-'));
    const nested = join(dir, 'a', 'b');
    const logging = createAgentLogging({ dir: nested });
    logging.logger.info('hello');
    logging.close();
    expect(existsSync(join(nested, LOG_FILE_NAME))).toBe(true);
  });
});
