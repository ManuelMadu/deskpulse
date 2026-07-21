import { describe, expect, it } from 'vitest';

import handshakeFixture from './fixtures/agent-ready-handshake.json' with { type: 'json' };
import { AGENT_EXIT_CODES, agentReadyHandshakeSchema } from './handshake.js';

describe('agent ready handshake', () => {
  it('round-trips the documented fixture (PDD §19)', () => {
    expect(agentReadyHandshakeSchema.parse(handshakeFixture)).toEqual(handshakeFixture);
  });

  it('rejects wrong type tags, unknown fields, and invalid ports', () => {
    expect(
      agentReadyHandshakeSchema.safeParse({ ...handshakeFixture, type: 'agent-ready' }).success,
    ).toBe(false);
    expect(
      agentReadyHandshakeSchema.safeParse({ ...handshakeFixture, token: 'leak' }).success,
    ).toBe(false);
    for (const port of [0, 65536, 1.5]) {
      expect(agentReadyHandshakeSchema.safeParse({ ...handshakeFixture, port }).success).toBe(
        false,
      );
    }
  });

  it('pins the sysexits-derived exit codes', () => {
    expect(AGENT_EXIT_CODES.noToken).toBe(78);
    expect(AGENT_EXIT_CODES.listenFailure).toBe(71);
  });
});
