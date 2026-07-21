import { watch } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ERROR_CODES, LIMITS } from '@deskpulse/contracts';

import { errnoToError } from '../errno.js';
import { LineSplitter } from './line-splitter.js';

import type { AgentEvent } from '@deskpulse/contracts';
import type { FSWatcher } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

const READ_CHUNK = 64 * 1024;

export interface TailerOptions {
  watchId: string;
  /** Already realpath-resolved by the caller (PDD §24 symlink handling). */
  realPath: string;
  fromEnd: boolean;
  encoding: 'utf8' | 'latin1';
  emit: (event: AgentEvent) => void;
  now?: () => number;
  /** Injectable timings so the slow recovery paths stay testable. */
  pollMs?: number;
  recreationWindowMs?: number;
  permissionRetryMs?: number;
  permissionMaxRetries?: number;
}

type TailerState = 'active' | 'deleted-wait' | 'permission-wait' | 'stopped';

/**
 * Tails one file (PDD §24 — the project's hardest correctness area). Directory
 * fs.watch catches rename/delete/create that watching the file itself misses
 * on macOS; a stat poll is the belt-and-braces guaranteeing ≤ pollMs staleness.
 * An open fd read at explicit offsets is what makes drain-after-rename work:
 * POSIX keeps the inode alive while the fd is open.
 */
export class Tailer {
  private readonly opts: Required<Omit<TailerOptions, 'emit' | 'now'>> &
    Pick<TailerOptions, 'emit'> & { now: () => number };

  private fd: FileHandle | undefined;
  private ino = -1;
  private dev = -1;
  private readOffset = 0;
  private emittedOffset = 0;
  private splitter: LineSplitter;

  private watcher: FSWatcher | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private flushTimer: NodeJS.Timeout | undefined;

  private state: TailerState = 'stopped';
  private checking = false;
  private recheck = false;

  private deletedSince = 0;
  private permissionAttempts = 0;
  private lastPermissionAttempt = 0;

  // Outbound batch (PDD §21 batching + FR-7 rate cap).
  private pending: { line: string; offset: number; at: string }[] = [];
  private droppedCount = 0;
  private truncatedCount = 0;
  private windowStart = 0;
  private deliveredInWindow = 0;

  constructor(options: TailerOptions) {
    this.opts = {
      watchId: options.watchId,
      realPath: options.realPath,
      fromEnd: options.fromEnd,
      encoding: options.encoding,
      emit: options.emit,
      now: options.now ?? Date.now,
      pollMs: options.pollMs ?? 1_000,
      recreationWindowMs: options.recreationWindowMs ?? LIMITS.logDeletedRecreationWindowMs,
      permissionRetryMs: options.permissionRetryMs ?? 5_000,
      permissionMaxRetries: options.permissionMaxRetries ?? 12,
    };
    this.splitter = new LineSplitter(options.encoding);
  }

  /** Open, seed the offset, and begin watching. Returns the initial position. */
  async start(): Promise<{ startOffset: number; fileSizeBytes: number }> {
    const handle = await open(this.opts.realPath, 'r');
    const info = await handle.stat();
    this.fd = handle;
    this.ino = Number(info.ino);
    this.dev = Number(info.dev);

    const size = info.size;
    this.readOffset = this.opts.fromEnd ? size : Math.max(0, size - LIMITS.logBackfillMaxBytes);
    this.emittedOffset = this.readOffset;
    // The reported start position is where we began, before any backfill read
    // advances readOffset.
    const startOffset = this.readOffset;
    this.state = 'active';

    if (!this.opts.fromEnd && this.readOffset < size) {
      await this.readTo(size);
    }

    this.watcher = watch(dirname(this.opts.realPath), () => {
      void this.check();
    });
    this.watcher.on('error', () => {
      /* directory watch errors are non-fatal; the poll still runs */
    });
    this.pollTimer = setInterval(() => void this.check(), this.opts.pollMs);
    this.pollTimer.unref();

    return { startOffset, fileSizeBytes: size };
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
    this.watcher?.close();
    this.watcher = undefined;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.fd) {
      await this.fd.close().catch(() => undefined);
      this.fd = undefined;
    }
  }

  /** Serialized: a change signal during a check just requests one more pass. */
  private async check(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }
    if (this.checking) {
      this.recheck = true;
      return;
    }
    this.checking = true;
    try {
      do {
        this.recheck = false;
        await this.runCheck();
      } while (this.recheck && !this.isStopped());
    } finally {
      this.checking = false;
    }
  }

  private isStopped(): boolean {
    return this.state === 'stopped';
  }

  private async runCheck(): Promise<void> {
    if (this.state === 'permission-wait') {
      return this.retryPermission();
    }

    let info;
    try {
      info = await stat(this.opts.realPath);
    } catch (error) {
      return this.handleStatError(error);
    }

    const ino = Number(info.ino);
    const dev = Number(info.dev);

    if (this.state === 'deleted-wait') {
      // File is back: treat the new inode as a rotation and resume.
      await this.rotateTo(ino, dev);
      return;
    }

    if (this.fd === undefined) {
      return;
    }

    if (ino !== this.ino || dev !== this.dev) {
      await this.drainCurrentFd();
      await this.rotateTo(ino, dev);
      return;
    }

    if (info.size < this.readOffset) {
      // Truncation: same inode, file shrank (e.g. `: > file`).
      const previousSize = this.readOffset;
      this.readOffset = 0;
      this.emittedOffset = 0;
      this.splitter = new LineSplitter(this.opts.encoding);
      this.emit({
        type: 'log.truncated',
        watchId: this.opts.watchId,
        previousSize,
        newSize: info.size,
      });
      await this.readTo(info.size);
    } else if (info.size > this.readOffset) {
      await this.readTo(info.size);
    }
  }

  private async handleStatError(error: unknown): Promise<void> {
    const shape = errnoToError(error, { path: this.opts.realPath });
    if (shape.code === ERROR_CODES.PERMISSION_DENIED) {
      this.enterPermissionWait(shape);
      return;
    }
    if (shape.code === ERROR_CODES.FILE_NOT_FOUND) {
      if (this.state !== 'deleted-wait') {
        await this.drainCurrentFd();
        await this.closeFd();
        this.state = 'deleted-wait';
        this.deletedSince = this.opts.now();
        this.emit({ type: 'log.deleted', watchId: this.opts.watchId, path: this.opts.realPath });
      } else if (this.opts.now() - this.deletedSince > this.opts.recreationWindowMs) {
        this.emit({
          type: 'log.error',
          watchId: this.opts.watchId,
          error: {
            code: ERROR_CODES.FILE_NOT_FOUND,
            message: 'The file was not recreated within the watch window.',
            retryable: false,
          },
        });
        void this.stop();
      }
      return;
    }
    // Any other stat error: surface it and stop.
    this.emit({ type: 'log.error', watchId: this.opts.watchId, error: shape });
    void this.stop();
  }

  private enterPermissionWait(shape: ReturnType<typeof errnoToError>): void {
    if (this.state !== 'permission-wait') {
      this.state = 'permission-wait';
      this.permissionAttempts = 0;
      this.lastPermissionAttempt = this.opts.now();
      this.emit({ type: 'log.error', watchId: this.opts.watchId, error: shape });
    }
  }

  private async retryPermission(): Promise<void> {
    if (this.opts.now() - this.lastPermissionAttempt < this.opts.permissionRetryMs) {
      return;
    }
    this.lastPermissionAttempt = this.opts.now();
    this.permissionAttempts += 1;
    try {
      await stat(this.opts.realPath);
      // Access restored: reopen from the current offset and resume.
      this.state = 'active';
      await this.reopenActive();
    } catch {
      if (this.permissionAttempts >= this.opts.permissionMaxRetries) {
        this.emit({
          type: 'log.error',
          watchId: this.opts.watchId,
          error: {
            code: ERROR_CODES.PERMISSION_DENIED,
            message: 'Permission was not restored; giving up on this watch.',
            retryable: false,
          },
        });
        void this.stop();
      }
    }
  }

  private async reopenActive(): Promise<void> {
    await this.closeFd();
    const handle = await open(this.opts.realPath, 'r');
    const info = await handle.stat();
    this.fd = handle;
    this.ino = Number(info.ino);
    this.dev = Number(info.dev);
    if (info.size < this.readOffset) {
      this.readOffset = 0;
      this.emittedOffset = 0;
      this.splitter = new LineSplitter(this.opts.encoding);
    }
    await this.readTo(info.size);
  }

  private async rotateTo(newIno: number, newDev: number): Promise<void> {
    const previousInode = this.ino;
    await this.closeFd();
    const handle = await open(this.opts.realPath, 'r');
    const info = await handle.stat();
    this.fd = handle;
    this.ino = newIno;
    this.dev = newDev;
    this.readOffset = 0;
    this.emittedOffset = 0;
    this.splitter = new LineSplitter(this.opts.encoding);
    this.state = 'active';
    this.emit({
      type: 'log.rotated',
      watchId: this.opts.watchId,
      previousInode: Math.max(0, previousInode),
      newInode: newIno,
      resumedAtOffset: 0,
    });
    await this.readTo(info.size);
  }

  /** Read the current fd to its own EOF (used before rotation/deletion). */
  private async drainCurrentFd(): Promise<void> {
    if (!this.fd) {
      return;
    }
    try {
      const info = await this.fd.stat();
      if (info.size > this.readOffset) {
        await this.readTo(info.size);
      }
    } catch {
      /* the fd may already be gone; nothing to drain */
    }
  }

  private async closeFd(): Promise<void> {
    if (this.fd) {
      await this.fd.close().catch(() => undefined);
      this.fd = undefined;
    }
  }

  /** Read [readOffset, to) from the current fd in bounded chunks. */
  private async readTo(to: number): Promise<void> {
    if (!this.fd) {
      return;
    }
    const buffer = Buffer.allocUnsafe(READ_CHUNK);
    while (this.readOffset < to && !this.isStopped()) {
      const want = Math.min(READ_CHUNK, to - this.readOffset);
      let result;
      try {
        result = await this.fd.read(buffer, 0, want, this.readOffset);
      } catch (error) {
        this.emit({
          type: 'log.error',
          watchId: this.opts.watchId,
          error: errnoToError(error, { path: this.opts.realPath }),
        });
        return;
      }
      if (result.bytesRead === 0) {
        break;
      }
      this.readOffset += result.bytesRead;
      for (const line of this.splitter.push(buffer.subarray(0, result.bytesRead))) {
        this.enqueue(line.text, line.byteLength, line.truncated);
      }
      // Yield so a flood can't monopolize the event loop.
      await Promise.resolve();
    }
  }

  private enqueue(text: string, byteLength: number, truncated: boolean): void {
    this.emittedOffset += byteLength;
    if (truncated) {
      this.truncatedCount += 1;
    }

    const now = this.opts.now();
    if (now - this.windowStart >= 1_000) {
      this.windowStart = now;
      this.deliveredInWindow = 0;
    }
    if (this.deliveredInWindow >= LIMITS.maxLogEntriesPerSecondPerWatch) {
      this.droppedCount += 1;
      return;
    }
    this.deliveredInWindow += 1;
    this.pending.push({ line: text, offset: this.emittedOffset, at: new Date(now).toISOString() });

    if (this.pending.length >= LIMITS.logBatchMaxLines) {
      this.flush();
    } else if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => this.flush(), LIMITS.logBatchFlushMs);
      this.flushTimer.unref();
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.length === 0) {
      return; // dropped/truncated counters ride the next batch that has entries
    }
    const entries = this.pending;
    this.pending = [];
    const dropped = this.droppedCount;
    const truncatedLines = this.truncatedCount;
    this.droppedCount = 0;
    this.truncatedCount = 0;
    this.emit({
      type: 'log.entry',
      watchId: this.opts.watchId,
      entries,
      dropped,
      truncatedLines,
    });
  }

  private emit(event: AgentEvent): void {
    // Flush buffered entries before any structural marker so ordering holds
    // (entries that arrived before a rotation precede the rotation event).
    if (event.type !== 'log.entry' && this.pending.length > 0) {
      this.flush();
    }
    this.opts.emit(event);
  }
}
