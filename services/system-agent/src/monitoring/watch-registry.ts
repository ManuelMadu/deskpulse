import { realpath, stat } from 'node:fs/promises';

import { DeskPulseError, ERROR_CODES, LIMITS } from '@deskpulse/contracts';

import { errnoToError } from '../errno.js';
import { uuidv7 } from '../uuid.js';
import { Tailer } from './tailer.js';

import type { EventBus } from '../events.js';
import type { StartWatchRequest, WatchCreated } from '@deskpulse/contracts';

/** Test seam so the registry can be driven with fast timers (PDD §24). */
export interface WatchRegistryOptions {
  tailerPollMs?: number;
  recreationWindowMs?: number;
}

/**
 * Owns the set of active tailers (max 5, FR-7). Validates the target file,
 * mints watch ids, wires each tailer's events onto the bus, and cleans up on
 * stop. The path arrives already user-selected from Main; the agent still
 * validates it (PDD §20 POST /watch).
 */
export class WatchRegistry {
  private readonly tailers = new Map<string, Tailer>();

  constructor(
    private readonly bus: EventBus,
    private readonly options: WatchRegistryOptions = {},
  ) {}

  get activeCount(): number {
    return this.tailers.size;
  }

  async add(request: StartWatchRequest): Promise<WatchCreated> {
    if (this.tailers.size >= LIMITS.maxLogWatches) {
      throw new DeskPulseError({
        code: ERROR_CODES.LIMIT_REACHED,
        message: `At most ${LIMITS.maxLogWatches} files can be watched at once.`,
        retryable: false,
      });
    }

    // Resolve symlinks once; the real path is what gets watched and echoed.
    let realPath: string;
    try {
      realPath = await realpath(request.path);
    } catch (error) {
      throw new DeskPulseError(errnoToError(error, { path: request.path }));
    }

    let info;
    try {
      info = await stat(realPath);
    } catch (error) {
      throw new DeskPulseError(errnoToError(error, { path: realPath }));
    }
    if (!info.isFile()) {
      throw new DeskPulseError({
        code: ERROR_CODES.NOT_A_FILE,
        message: 'Only regular files can be watched.',
        retryable: false,
        details: { path: realPath },
      });
    }

    const id = uuidv7();
    const tailer = new Tailer({
      watchId: id,
      realPath,
      fromEnd: request.fromEnd,
      encoding: request.encoding,
      emit: (event) => this.bus.publish(event),
      ...(this.options.tailerPollMs !== undefined ? { pollMs: this.options.tailerPollMs } : {}),
      ...(this.options.recreationWindowMs !== undefined
        ? { recreationWindowMs: this.options.recreationWindowMs }
        : {}),
    });

    let started: { startOffset: number; fileSizeBytes: number };
    try {
      started = await tailer.start();
    } catch (error) {
      await tailer.stop();
      throw new DeskPulseError(errnoToError(error, { path: realPath }));
    }

    this.tailers.set(id, tailer);
    return {
      id,
      path: request.path,
      realPath,
      startOffset: started.startOffset,
      fileSizeBytes: started.fileSizeBytes,
    };
  }

  /** Idempotent: removing an unknown id is a no-op (Main treats 404 as success). */
  async remove(id: string): Promise<boolean> {
    const tailer = this.tailers.get(id);
    if (!tailer) {
      return false;
    }
    this.tailers.delete(id);
    await tailer.stop();
    return true;
  }

  async closeAll(): Promise<void> {
    const all = [...this.tailers.values()];
    this.tailers.clear();
    await Promise.all(all.map((t) => t.stop()));
  }
}
