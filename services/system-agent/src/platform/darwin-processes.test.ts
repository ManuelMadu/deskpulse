import { describe, expect, it, vi } from 'vitest';

import { createDarwinProcessProvider, parsePsOutput, sortAndLimit } from './darwin-processes.js';

const GNARLY_PS_OUTPUT = [
  '    1   0.0    9744 /sbin/launchd',
  '  812  42.1  307200 /usr/local/bin/node',
  ' 1201   3.5  204800 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/138.0.0.0/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)',
  '  455   0.3   51200 mdworker_shared',
  '  999 120.4  102400 /Users/me/my weird dir/my app',
  'garbage line that does not parse',
  '  -5   1.0     100 /bin/negative-pid',
  '',
].join('\n');

describe('parsePsOutput (fixture, gnarly comm values)', () => {
  const processes = parsePsOutput(GNARLY_PS_OUTPUT);

  it('parses valid lines and skips garbage and invalid pids', () => {
    expect(processes.map((p) => p.pid)).toEqual([1, 812, 1201, 455, 999]);
  });

  it('basenames comm for display, preserving spaces and parentheses', () => {
    expect(processes.map((p) => p.name)).toEqual([
      'launchd',
      'node',
      'Google Chrome Helper (Renderer)',
      'mdworker_shared',
      'my app',
    ]);
  });

  it('converts rss KiB to bytes and keeps >100% multi-core cpu', () => {
    const node = processes.find((p) => p.pid === 812)!;
    expect(node.memoryRssBytes).toBe(307200 * 1024);
    expect(processes.find((p) => p.pid === 999)!.cpuPercent).toBeCloseTo(120.4);
  });
});

describe('sortAndLimit', () => {
  const processes = parsePsOutput(GNARLY_PS_OUTPUT);

  it('sorts by cpu descending and applies the limit', () => {
    const top2 = sortAndLimit(processes, { limit: 2, sortBy: 'cpu' });
    expect(top2.map((p) => p.pid)).toEqual([999, 812]);
  });

  it('sorts by memory descending', () => {
    const byMemory = sortAndLimit(processes, { limit: 3, sortBy: 'memory' });
    expect(byMemory.map((p) => p.pid)).toEqual([812, 1201, 999]);
  });
});

describe('createDarwinProcessProvider cache', () => {
  it('shares one ps invocation across calls inside the cache window', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: GNARLY_PS_OUTPUT });
    const provider = createDarwinProcessProvider(exec, 60_000);

    const [a, b] = await Promise.all([
      provider.list({ limit: 5, sortBy: 'cpu' }),
      provider.list({ limit: 2, sortBy: 'memory' }),
    ]);
    await provider.list({ limit: 1, sortBy: 'cpu' });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(a.processes).toHaveLength(5);
    expect(b.processes).toHaveLength(2);
    expect(a.sampledAt).toBe(b.sampledAt);
  });

  it('refreshes after the cache window', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: GNARLY_PS_OUTPUT });
    const provider = createDarwinProcessProvider(exec, 10);
    await provider.list({ limit: 1, sortBy: 'cpu' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await provider.list({ limit: 1, sortBy: 'cpu' });
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
