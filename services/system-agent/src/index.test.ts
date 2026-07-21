import { describe, expect, it } from 'vitest';

import { AGENT_NAME, agentIdentity } from './index.js';

describe('system-agent workspace', () => {
  it('reports its identity and the contracts version it was built against', () => {
    const identity = agentIdentity();
    expect(identity.name).toBe(AGENT_NAME);
    expect(identity.contractsVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
