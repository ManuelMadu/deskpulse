import { LIMITS, agentEventSchema } from '@deskpulse/contracts';

import type { AgentEndpoint } from './agent-client.js';
import type { AgentEvent } from '@deskpulse/contracts';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

type Logger = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx?: Record<string, unknown>,
) => void;

/**
 * Consumes the agent's SSE stream once, in Main, and hands validated events
 * to a sink that fans them out over IPC (PDD §14, §21). Reconnects with
 * 1→10 s backoff, resumes with Last-Event-ID, and treats > 45 s of silence
 * (heartbeats included) as a dead connection. The renderer never sees the
 * raw stream or the token.
 */
export class AgentEventConsumer {
  private abort: AbortController | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stalenessTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectDelay = RECONNECT_MIN_MS;
  private lastEventId: number | undefined;
  private lastActivity = 0;
  private running = false;

  constructor(
    private readonly getEndpoint: () => AgentEndpoint | undefined,
    private readonly onEvent: (event: AgentEvent) => void,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Begin consuming; call again after a supervisor restart to reattach. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    // A fresh agent run restarts ids at 1, so drop any id from a prior run.
    this.lastEventId = undefined;
    this.stalenessTimer = setInterval(() => this.checkStaleness(), 5_000);
    this.stalenessTimer.unref();
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.abort = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = undefined;
    }
  }

  private checkStaleness(): void {
    if (!this.running || !this.abort) {
      return;
    }
    if (this.now() - this.lastActivity > LIMITS.sseStalenessMs) {
      this.log('warn', 'SSE stream went silent; reconnecting');
      this.abort.abort(); // triggers the connect() catch → scheduled reconnect
    }
  }

  private async connect(): Promise<void> {
    const endpoint = this.getEndpoint();
    if (!this.running || !endpoint) {
      this.scheduleReconnect();
      return;
    }

    const abort = new AbortController();
    this.abort = abort;
    this.lastActivity = this.now();

    try {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/events`, {
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          accept: 'text/event-stream',
          ...(this.lastEventId !== undefined ? { 'last-event-id': String(this.lastEventId) } : {}),
        },
        signal: abort.signal,
      });
      if (response.status !== 200 || !response.body) {
        throw new Error(`stream returned ${response.status}`);
      }
      // A clean open resets the backoff ladder.
      this.reconnectDelay = RECONNECT_MIN_MS;
      await this.readStream(response.body);
    } catch (error) {
      if (this.running) {
        this.log('warn', 'SSE connection lost', { cause: String(error) });
      }
    } finally {
      if (this.abort === abort) {
        this.abort = undefined;
      }
    }

    this.scheduleReconnect();
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      this.lastActivity = this.now();
      buffer += decoder.decode(chunk.value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        this.handleFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
  }

  private handleFrame(raw: string): void {
    if (raw.startsWith(':') || raw.trim() === '') {
      return; // heartbeat / comment
    }
    let id: number | undefined;
    let data: string | undefined;
    for (const line of raw.split('\n')) {
      if (line.startsWith('id: ')) {
        id = Number(line.slice(4));
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
      }
    }
    if (data === undefined) {
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.log('warn', 'discarded non-JSON SSE frame');
      return;
    }
    const parsed = agentEventSchema.safeParse(json);
    if (!parsed.success) {
      // A malformed frame is dropped, never propagated (PDD §30 agent validation).
      this.log('warn', 'discarded malformed SSE event');
      return;
    }
    if (id !== undefined && Number.isInteger(id)) {
      this.lastEventId = id;
    }
    this.onEvent(parsed.data);
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
