import { z } from 'zod';

import { ERROR_CODES } from './error-codes.js';

import type { ErrorCode } from './error-codes.js';

const errorCodeSchema = z.enum(Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]);

/**
 * The one error shape used everywhere: HTTP error responses, IPC rejections,
 * SSE failure payloads (PDD §31). `message` must always be safe to display
 * verbatim; anything sensitive belongs in logs, never in `message`.
 */
export const deskPulseErrorShapeSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
});

export type DeskPulseErrorShape = z.infer<typeof deskPulseErrorShapeSchema>;

/** HTTP wire envelope: every non-2xx agent response is exactly this. */
export const errorEnvelopeSchema = z.strictObject({
  error: deskPulseErrorShapeSchema,
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Throwable carrier for the shape. Plain class — no Node/Electron imports —
 * so it crosses every workspace including the sandboxed renderer's types.
 */
export class DeskPulseError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(shape: DeskPulseErrorShape) {
    super(shape.message);
    this.name = 'DeskPulseError';
    this.code = shape.code;
    this.details = shape.details;
    this.retryable = shape.retryable;
  }

  toShape(): DeskPulseErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      retryable: this.retryable,
    };
  }

  toEnvelope(): ErrorEnvelope {
    return { error: this.toShape() };
  }

  static fromEnvelope(envelope: ErrorEnvelope): DeskPulseError {
    return new DeskPulseError(envelope.error);
  }
}
