import { request } from 'undici';

import type { ExpectedStatus, ProbeFailureReason, ProbeResult } from '@deskpulse/contracts';

/** Cap on bytes drained from the response body; we never read the payload. */
const MAX_DRAIN_BYTES = 4 * 1024;

export interface ProbeSpec {
  url: string;
  method: 'GET' | 'HEAD';
  timeoutMs: number;
  expectedStatus: ExpectedStatus;
}

export type ProbeFn = (spec: ProbeSpec, nowMs: number) => Promise<ProbeResult>;

function classify(error: unknown): ProbeFailureReason {
  const code = (error as { code?: string }).code;
  const name = (error as { name?: string }).name;
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return 'timeout';
  }
  if (code === 'ECONNREFUSED') {
    return 'connection-refused';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'dns';
  }
  if (typeof code === 'string' && (code.startsWith('ERR_TLS') || code.startsWith('CERT'))) {
    return 'tls';
  }
  return 'aborted';
}

/**
 * One health probe (PDD §25): undici with a hard abort timeout, no redirects
 * followed, body drained and discarded (≤ 4 KiB). ok = status in range AND no
 * transport error AND within timeout. Timing is monotonic-ish via the caller's
 * clock so tests stay deterministic.
 */
export async function probeOnce(spec: ProbeSpec, nowMs: number = Date.now()): Promise<ProbeResult> {
  const start = performance.now();
  try {
    // undici's request does not follow redirects unless a redirect interceptor
    // is installed, so a 3xx outside the expected range is a failure by
    // default — exactly the health-check semantics we want (PDD §25).
    const response = await request(spec.url, {
      method: spec.method,
      signal: AbortSignal.timeout(spec.timeoutMs),
      headers: { 'user-agent': 'DeskPulse/0.1' },
    });

    // Drain a bounded amount so the socket can be reused, then discard.
    let drained = 0;
    try {
      for await (const chunk of response.body) {
        drained += (chunk as Buffer).byteLength;
        if (drained >= MAX_DRAIN_BYTES) {
          break;
        }
      }
      response.body.destroy();
    } catch {
      /* body drain errors don't change the status verdict */
    }

    const latencyMs = Math.round(performance.now() - start);
    const inRange =
      response.statusCode >= spec.expectedStatus.min &&
      response.statusCode <= spec.expectedStatus.max;

    return inRange
      ? { at: new Date(nowMs).toISOString(), ok: true, statusCode: response.statusCode, latencyMs }
      : {
          at: new Date(nowMs).toISOString(),
          ok: false,
          statusCode: response.statusCode,
          latencyMs,
          reason: 'unexpected-status',
        };
  } catch (error) {
    return {
      at: new Date(nowMs).toISOString(),
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      reason: classify(error),
    };
  }
}
