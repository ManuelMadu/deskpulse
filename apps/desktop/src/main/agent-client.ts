import { DeskPulseError, ERROR_CODES, errorEnvelopeSchema } from '@deskpulse/contracts';
import { request } from 'undici';

import type { ZodType } from 'zod';

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Typed HTTP client for the agent (PDD §16). Every response body is parsed
 * against its contract schema before use — a malformed agent response
 * becomes MALFORMED_RESPONSE, never silent undefined propagation. Errors
 * always surface as DeskPulseError so IPC handlers can forward the shape.
 */
export interface AgentEndpoint {
  port: number;
  token: string;
}

export class AgentClient {
  constructor(private readonly getEndpoint: () => AgentEndpoint | undefined) {}

  async get<T>(path: string, schema: ZodType<T>): Promise<T> {
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      throw new DeskPulseError({
        code: ERROR_CODES.AGENT_UNAVAILABLE,
        message: 'The system agent is not running.',
        retryable: true,
      });
    }

    let statusCode: number;
    let body: unknown;
    try {
      const response = await request(`http://127.0.0.1:${endpoint.port}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${endpoint.token}` },
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
      });
      statusCode = response.statusCode;
      body = await response.body.json().catch(() => undefined);
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === 'HeadersTimeoutError' || error.name === 'BodyTimeoutError');
      throw new DeskPulseError({
        code: isTimeout ? ERROR_CODES.REQUEST_TIMEOUT : ERROR_CODES.AGENT_UNAVAILABLE,
        message: isTimeout
          ? 'The agent did not respond in time.'
          : 'Could not reach the system agent.',
        details: { cause: String(error) },
        retryable: true,
      });
    }

    if (statusCode >= 200 && statusCode < 300) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new DeskPulseError({
          code: ERROR_CODES.MALFORMED_RESPONSE,
          message: 'The agent returned a response that failed contract validation.',
          details: { path, issues: parsed.error.issues.slice(0, 5) },
          retryable: false,
        });
      }
      return parsed.data;
    }

    const envelope = errorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      throw DeskPulseError.fromEnvelope(envelope.data);
    }
    throw new DeskPulseError({
      code: ERROR_CODES.MALFORMED_RESPONSE,
      message: `The agent returned HTTP ${statusCode} without a valid error envelope.`,
      details: { path, statusCode },
      retryable: false,
    });
  }
}
