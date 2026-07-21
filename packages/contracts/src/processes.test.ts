import { describe, expect, it } from 'vitest';

import processesFixture from './fixtures/processes-response.json' with { type: 'json' };
import { processQuerySchema, processesResponseSchema } from './processes.js';

describe('GET /processes query schema', () => {
  it('applies documented defaults', () => {
    expect(processQuerySchema.parse({})).toEqual({ limit: 20, sortBy: 'cpu' });
  });

  it('coerces string params from the URL', () => {
    expect(processQuerySchema.parse({ limit: '5', sortBy: 'memory' })).toEqual({
      limit: 5,
      sortBy: 'memory',
    });
  });

  it('rejects out-of-range limits, bad sort keys, and unknown params', () => {
    for (const bad of [
      { limit: '0' },
      { limit: '51' },
      { limit: 'abc' },
      { limit: '2.5' },
      { sortBy: 'disk' },
      { verbose: '1' },
    ]) {
      expect(processQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('GET /processes response schema', () => {
  it('round-trips the documented fixture (PDD §20)', () => {
    expect(processesResponseSchema.parse(processesFixture)).toEqual(processesFixture);
  });

  it('allows per-process CPU above 100 % (multi-core) but never negative', () => {
    const withBusy = {
      ...processesFixture,
      processes: [{ ...processesFixture.processes[0], cpuPercent: 340.5 }],
    };
    expect(processesResponseSchema.safeParse(withBusy).success).toBe(true);

    const negative = {
      ...processesFixture,
      processes: [{ ...processesFixture.processes[0], cpuPercent: -1 }],
    };
    expect(processesResponseSchema.safeParse(negative).success).toBe(false);
  });

  it('rejects unknown fields on process entries', () => {
    const extra = {
      ...processesFixture,
      processes: [{ ...processesFixture.processes[0], command: '/usr/bin/node' }],
    };
    expect(processesResponseSchema.safeParse(extra).success).toBe(false);
  });
});
