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

  get<T>(path: string, schema: ZodType<T>): Promise<T> {
    return this.send('GET', path, schema);
  }

  post<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    return this.send('POST', path, schema, body);
  }

  patch<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
    return this.send('PATCH', path, schema, body);
  }

  /** DELETE where the agent replies 204 with no body; 404 is treated as success. */
  async delete(path: string): Promise<void> {
    const endpoint = this.requireEndpoint();
    let statusCode: number;
    let body: unknown;
    try {
      const response = await request(`http://127.0.0.1:${endpoint.port}${path}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${endpoint.token}` },
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
      });
      statusCode = response.statusCode;
      body = await response.body.json().catch(() => undefined);
    } catch (error) {
      throw this.transportError(error);
    }
    // Idempotent from Main's perspective: gone is gone (PDD §20).
    if (statusCode === 204 || statusCode === 404) {
      return;
    }
    this.throwFromError(statusCode, body, path);
  }

  private requireEndpoint(): AgentEndpoint {
    const endpoint = this.getEndpoint();
    if (!endpoint) {
      throw new DeskPulseError({
        code: ERROR_CODES.AGENT_UNAVAILABLE,
        message: 'The system agent is not running.',
        retryable: true,
      });
    }
    return endpoint;
  }

  private transportError(error: unknown): DeskPulseError {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'HeadersTimeoutError' || error.name === 'BodyTimeoutError');
    return new DeskPulseError({
      code: isTimeout ? ERROR_CODES.REQUEST_TIMEOUT : ERROR_CODES.AGENT_UNAVAILABLE,
      message: isTimeout
        ? 'The agent did not respond in time.'
        : 'Could not reach the system agent.',
      details: { cause: String(error) },
      retryable: true,
    });
  }

  private throwFromError(statusCode: number, body: unknown, path: string): never {
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

  private async send<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    schema: ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const endpoint = this.requireEndpoint();

    let statusCode: number;
    let responseBody: unknown;
    try {
      const response = await request(`http://127.0.0.1:${endpoint.port}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
      });
      statusCode = response.statusCode;
      responseBody = await response.body.json().catch(() => undefined);
    } catch (error) {
      throw this.transportError(error);
    }

    if (statusCode >= 200 && statusCode < 300) {
      const parsed = schema.safeParse(responseBody);
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

    this.throwFromError(statusCode, responseBody, path);
  }
}
