import { describe, expect, it } from 'vitest';

import { diagnosticsProgressEventSchema } from './events.js';
import { exportRequestSchema, exportStartedSchema } from './diagnostics.js';

describe('exportRequestSchema', () => {
  it('applies sensible defaults for an empty request', () => {
    expect(exportRequestSchema.parse({})).toEqual({
      includeHealthHistory: true,
      redactAgentLogs: true,
      extraLogPaths: [],
    });
  });

  it('accepts a fully specified request', () => {
    const req = {
      includeHealthHistory: false,
      redactAgentLogs: false,
      extraLogPaths: ['/Users/me/app.log'],
      mainLogPath: '/tmp/deskpulse-main.log',
    };
    expect(exportRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects too many extra logs and unknown fields', () => {
    expect(exportRequestSchema.safeParse({ extraLogPaths: Array(11).fill('/x') }).success).toBe(
      false,
    );
    expect(exportRequestSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

describe('exportStartedSchema', () => {
  it('requires a uuid exportId and a staging path', () => {
    const ok = {
      exportId: '018f1111-1111-4111-8111-111111111111',
      stagingPath: '/var/folders/x/deskpulse-export/bundle.zip',
    };
    expect(exportStartedSchema.parse(ok)).toEqual(ok);
    expect(exportStartedSchema.safeParse({ exportId: 'nope', stagingPath: '/x' }).success).toBe(
      false,
    );
  });
});

describe('diagnosticsProgressEventSchema', () => {
  it('accepts each stage and clamps percent to 0–100', () => {
    for (const stage of ['collect', 'zip', 'done', 'failed'] as const) {
      expect(
        diagnosticsProgressEventSchema.parse({
          type: 'diagnostics.progress',
          exportId: '018f1111-1111-4111-8111-111111111111',
          stage,
          percent: 50,
        }).stage,
      ).toBe(stage);
    }
    expect(
      diagnosticsProgressEventSchema.safeParse({
        type: 'diagnostics.progress',
        exportId: '018f1111-1111-4111-8111-111111111111',
        stage: 'zip',
        percent: 120,
      }).success,
    ).toBe(false);
  });
});
