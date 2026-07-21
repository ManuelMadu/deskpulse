import { describe, expect, it } from 'vitest';

import { barLevel, formatBytes, formatPercent, formatUptime } from './format.js';

describe('formatBytes', () => {
  it('scales GB, MB, and KB with sensible precision', () => {
    expect(formatBytes(17179869184)).toBe('16.0 GB');
    expect(formatBytes(314572800)).toBe('300 MB');
    expect(formatBytes(51200)).toBe('50 KB');
    expect(formatBytes(0)).toBe('0 KB');
  });

  it('refuses garbage', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('renders one decimal and tolerates >100 (per-process multi-core)', () => {
    expect(formatPercent(23.44)).toBe('23.4%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(340.5)).toBe('340.5%');
    expect(formatPercent(-1)).toBe('—');
  });
});

describe('formatUptime', () => {
  it('picks the two most significant units', () => {
    expect(formatUptime(345600)).toBe('4d 0h');
    expect(formatUptime(11520)).toBe('3h 12m');
    expect(formatUptime(59)).toBe('0m');
    expect(formatUptime(-5)).toBe('—');
  });
});

describe('barLevel thresholds', () => {
  it('is quiet below 70, warns to 89.9, fails at 90+', () => {
    expect(barLevel(0)).toBe('rest');
    expect(barLevel(69.9)).toBe('rest');
    expect(barLevel(70)).toBe('warn');
    expect(barLevel(89.9)).toBe('warn');
    expect(barLevel(90)).toBe('fail');
    expect(barLevel(400)).toBe('fail');
  });
});
