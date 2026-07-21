import { DROPPABLE_EVENT_TYPES, LIMITS } from '@deskpulse/contracts';

import type { EventBus, PublishedEvent } from '../events.js';
import type { RouteHandler } from './router.js';
import type { AgentEvent } from '@deskpulse/contracts';
import type { ServerResponse } from 'node:http';

/**
 * SSE endpoint (PDD §21). One route, all event types multiplexed. Auth runs
 * ahead of routing (§20), so this only handles the stream lifecycle:
 * connection cap, Last-Event-ID replay / stream.reset, heartbeat, and
 * per-connection backpressure with a drop-then-close policy.
 */

interface AgentIdentity {
  pid: number;
  version: string;
  runId: string;
}

function frame(id: number, event: AgentEvent): string {
  // event name mirrors the payload's type so a curl reader can filter by it.
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

class SseConnection {
  private closed = false;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly res: ServerResponse,
    private readonly bus: EventBus,
    private readonly identity: AgentIdentity,
    private readonly onClose: (self: SseConnection) => void,
  ) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });

    this.heartbeat = setInterval(() => this.send(': hb\n\n'), LIMITS.sseHeartbeatMs);
    this.heartbeat.unref();

    res.on('close', () => this.dispose());
    res.on('error', () => this.dispose());
  }

  /** Replay missed events (or reset), announce readiness, then go live. */
  start(lastEventId: number | undefined): void {
    if (lastEventId !== undefined) {
      const replay = this.bus.replayAfter(lastEventId);
      if (replay.kind === 'reset') {
        this.write(frame(this.bus.lastId, { type: 'stream.reset', reason: replay.reason }));
      } else {
        for (const published of replay.events) {
          this.write(frame(published.id, published.event));
        }
      }
    }

    // agent.status ready is published through the bus so it also lands in the
    // replay buffer and carries a real id.
    this.bus.publish({
      type: 'agent.status',
      status: 'ready',
      pid: this.identity.pid,
      version: this.identity.version,
      runId: this.identity.runId,
    });
  }

  deliver(published: PublishedEvent): void {
    if (this.closed) {
      return;
    }
    const buffered = this.res.writableLength;
    if (
      buffered > LIMITS.sseDropThresholdBytes &&
      DROPPABLE_EVENT_TYPES.includes(published.event.type)
    ) {
      // Slow consumer: shed log.entry batches but never transition/status
      // events. The dropped lines are already accounted in later batches'
      // `dropped` counters (§21, §24).
      return;
    }
    if (buffered > LIMITS.sseCloseThresholdBytes) {
      // Hopelessly behind even on non-droppable events: cut it and let the
      // client reconnect from its Last-Event-ID.
      this.dispose();
      return;
    }
    this.write(frame(published.id, published.event));
  }

  private write(chunk: string): void {
    this.send(chunk);
  }

  private send(chunk: string): void {
    if (this.closed) {
      return;
    }
    this.res.write(chunk);
  }

  dispose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.heartbeat);
    this.onClose(this);
    this.res.end();
  }
}

export interface SseHub {
  route: RouteHandler;
  /** Active connection count, for tests and health. */
  readonly connectionCount: number;
  closeAll(): void;
}

export function createSseHub(bus: EventBus, identity: AgentIdentity): SseHub {
  const connections = new Set<SseConnection>();
  const subscribers = new Map<SseConnection, () => void>();

  const route: RouteHandler = ({ req, res }) => {
    if (connections.size >= LIMITS.maxSseConnections) {
      res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: {
            code: 'LIMIT_REACHED',
            message: 'Too many event stream connections.',
            retryable: true,
          },
        }),
      );
      return;
    }

    const remove = (connection: SseConnection): void => {
      connections.delete(connection);
      subscribers.get(connection)?.();
      subscribers.delete(connection);
    };

    const connection = new SseConnection(res, bus, identity, remove);
    connections.add(connection);
    subscribers.set(
      connection,
      bus.subscribe((published) => connection.deliver(published)),
    );

    const header = req.headers['last-event-id'];
    const raw = Array.isArray(header) ? header[0] : header;
    const parsed = raw !== undefined ? Number(raw) : Number.NaN;
    connection.start(Number.isInteger(parsed) ? parsed : undefined);
  };

  return {
    route,
    get connectionCount() {
      return connections.size;
    },
    closeAll() {
      for (const connection of [...connections]) {
        connection.dispose();
      }
    },
  };
}
