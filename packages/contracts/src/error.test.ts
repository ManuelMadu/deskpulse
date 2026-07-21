import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_HTTP_STATUS } from './error-codes.js';
import { DeskPulseError, deskPulseErrorShapeSchema, errorEnvelopeSchema } from './error.js';
import errorEnvelopeFixture from './fixtures/error-envelope.json' with { type: 'json' };

describe('error envelope', () => {
  it('round-trips the documented fixture (PDD §31)', () => {
    const parsed = errorEnvelopeSchema.parse(errorEnvelopeFixture);
    expect(parsed).toEqual(errorEnvelopeFixture);
  });

  it('rejects unknown fields at both envelope and shape level', () => {
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'INTERNAL', message: 'x', retryable: false },
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: 'INTERNAL', message: 'x', retryable: false, severity: 'high' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown codes and empty messages', () => {
    expect(
      deskPulseErrorShapeSchema.safeParse({ code: 'NOPE', message: 'x', retryable: false }).success,
    ).toBe(false);
    expect(
      deskPulseErrorShapeSchema.safeParse({ code: 'INTERNAL', message: '', retryable: false })
        .success,
    ).toBe(false);
  });

  it('every wire-served code maps to a valid HTTP status', () => {
    for (const [code, status] of Object.entries(ERROR_HTTP_STATUS)) {
      expect(code in ERROR_CODES, `${code} must be a declared code`).toBe(true);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it('client-side-only codes never get an HTTP status', () => {
    for (const code of ['REQUEST_TIMEOUT', 'AGENT_UNAVAILABLE', 'MALFORMED_RESPONSE'] as const) {
      expect(ERROR_HTTP_STATUS[code]).toBeUndefined();
    }
  });
});

describe('DeskPulseError', () => {
  it('round-trips shape → class → envelope → class', () => {
    const shape = {
      code: ERROR_CODES.PERMISSION_DENIED,
      message: 'Cannot read file.',
      details: { errno: -13 },
      retryable: true,
    };
    const error = new DeskPulseError(shape);
    expect(error.toShape()).toEqual(shape);

    const revived = DeskPulseError.fromEnvelope(errorEnvelopeSchema.parse(error.toEnvelope()));
    expect(revived.code).toBe(shape.code);
    expect(revived.message).toBe(shape.message);
    expect(revived.retryable).toBe(true);
    expect(revived).toBeInstanceOf(Error);
  });

  it('omits details from the shape when absent (strict schemas reject undefined keys)', () => {
    const error = new DeskPulseError({
      code: ERROR_CODES.NOT_READY,
      message: 'First sample pending.',
      retryable: true,
    });
    expect('details' in error.toShape()).toBe(false);
    expect(errorEnvelopeSchema.safeParse(error.toEnvelope()).success).toBe(true);
  });
});
