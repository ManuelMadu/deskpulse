import { ERROR_CODES, LIMITS } from '@deskpulse/contracts';

import type { IncomingMessage } from 'node:http';

export class BodyError extends Error {
  constructor(
    readonly code: typeof ERROR_CODES.PAYLOAD_TOO_LARGE | typeof ERROR_CODES.VALIDATION_FAILED,
    message: string,
  ) {
    super(message);
    this.name = 'BodyError';
  }
}

/**
 * Reads a JSON request body, hard-capped at LIMITS.maxRequestBodyBytes.
 * The cap is enforced while streaming — an oversized body is rejected as soon
 * as the limit is crossed, not after buffering it (PDD §20, §30).
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > LIMITS.maxRequestBodyBytes) {
    throw new BodyError(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body exceeds the 64 KiB limit.');
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    received += buffer.byteLength;
    if (received > LIMITS.maxRequestBodyBytes) {
      throw new BodyError(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body exceeds the 64 KiB limit.');
    }
    chunks.push(buffer);
  }

  if (received === 0) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new BodyError(ERROR_CODES.VALIDATION_FAILED, 'Request body is not valid JSON.');
  }
}
