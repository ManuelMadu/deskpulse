import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import os from 'node:os';

import { DeskPulseError, ERROR_CODES } from '@deskpulse/contracts';

import { createRedactStream } from './redactor.js';

import type { Archiver, ArchiverError } from 'archiver';
import type {
  AgentEvent,
  DeskPulseErrorShape,
  ExportRequest,
  ExportStarted,
  MonitorWithStatus,
  ProcessesResponse,
  SystemSummary,
} from '@deskpulse/contracts';

// archiver is a CommonJS `export =` module; require it to sidestep ESM
// default-interop under verbatimModuleSyntax (types come from @types/archiver).
const createArchive = createRequire(import.meta.url)('archiver') as (
  format: string,
  options?: { zlib?: { level?: number } },
) => Archiver;

/** DeskPulse's own logs are tailed to the last 5 MiB (PDD §27, FR-21). */
const AGENT_LOG_TAIL_BYTES = 5 * 1024 * 1024;
/** User-selected logs are capped at 25 MiB with a truncation marker (§27). */
const USER_LOG_TAIL_BYTES = 25 * 1024 * 1024;
const BUNDLE_FORMAT_VERSION = 1;

export interface WatchExportInfo {
  id: string;
  path: string;
}

export interface ExportSources {
  version: string;
  systemSummary: () => SystemSummary | undefined;
  processes: () => Promise<ProcessesResponse>;
  monitors: () => MonitorWithStatus[];
  watches: () => WatchExportInfo[];
  agentLogPath: string;
  emit: (event: AgentEvent) => void;
  /** Staging root; defaults to the OS temp dir. */
  tempDir?: string;
  /** Injectable for tests: free bytes on the volume holding `dir`. */
  freeBytes?: (dir: string) => Promise<number>;
  now?: () => Date;
}

const README = `DeskPulse diagnostic bundle
===========================

Contents:
  manifest.json   bundle format, app/agent versions, macOS/arch, options used
  system.json     system metrics snapshot + top processes at export time
  monitors.json   monitor configs (and recent probe history, if included)
  watches.json    active log-watch configs
  logs/agent.log  DeskPulse agent log (last 5 MiB; redacted unless disabled)
  logs/main.log   DeskPulse main-process log (last 5 MiB; redacted unless disabled)
  user-logs/      any log files you selected, included VERBATIM

Redaction is best-effort and applies ONLY to DeskPulse's own logs and monitor
history (Authorization headers, bearer tokens, password/token/secret/api-key
values, AWS key ids). User-selected logs are NOT redacted — review them before
sharing this bundle.
`;

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * Single-flight diagnostic-bundle builder (PDD §27). `start()` validates disk
 * space and returns immediately (202); the ZIP is streamed together in the
 * background — never buffering a whole log — with `diagnostics.progress` events
 * per stage. Any failure emits `stage:"failed"` and deletes the staging dir so
 * a partial ZIP never escapes.
 */
export class DiagnosticsExporter {
  private running = false;

  constructor(private readonly sources: ExportSources) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(request: ExportRequest): Promise<ExportStarted> {
    if (this.running) {
      throw new DeskPulseError({
        code: ERROR_CODES.EXPORT_IN_PROGRESS,
        message: 'A diagnostic export is already running.',
        retryable: true,
      });
    }
    this.running = true;
    const exportId = randomUUID();
    const root = this.sources.tempDir ?? tmpdir();
    const stagingDir = await mkdtemp(join(root, `deskpulse-export-${exportId}-`));
    const stagingPath = join(stagingDir, 'bundle.zip');

    try {
      await this.preflight(request, stagingDir);
    } catch (error) {
      this.running = false;
      await rm(stagingDir, { recursive: true, force: true });
      throw error;
    }

    void this.build(exportId, request, stagingDir, stagingPath).finally(() => {
      this.running = false;
    });
    return { exportId, stagingPath };
  }

  private async preflight(request: ExportRequest, stagingDir: string): Promise<void> {
    let estimate = await fileSize(this.sources.agentLogPath);
    if (request.mainLogPath) {
      estimate += await fileSize(request.mainLogPath);
    }
    for (const path of request.extraLogPaths) {
      estimate += Math.min(USER_LOG_TAIL_BYTES, await fileSize(path));
    }
    const free = this.sources.freeBytes
      ? await this.sources.freeBytes(stagingDir)
      : await defaultFreeBytes(stagingDir);
    if (free < estimate * 2) {
      throw new DeskPulseError({
        code: ERROR_CODES.INSUFFICIENT_SPACE,
        message: 'Not enough free disk space to build the diagnostic bundle.',
        retryable: false,
      });
    }
  }

  private async build(
    exportId: string,
    request: ExportRequest,
    stagingDir: string,
    stagingPath: string,
  ): Promise<void> {
    const emit = (
      stage: 'collect' | 'zip' | 'done' | 'failed',
      percent: number,
      extra?: { currentItem?: string; error?: DeskPulseErrorShape },
    ): void => {
      this.sources.emit({
        type: 'diagnostics.progress',
        exportId,
        stage,
        percent,
        ...(extra?.currentItem !== undefined ? { currentItem: extra.currentItem } : {}),
        ...(extra?.error !== undefined ? { error: extra.error } : {}),
      });
    };

    try {
      emit('collect', 5);
      const archive = createArchive('zip', { zlib: { level: 9 } });
      const output = createWriteStream(stagingPath);
      const finished = new Promise<void>((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.on('warning', (warning: ArchiverError) => {
          if (warning.code !== 'ENOENT') {
            reject(warning);
          }
        });
      });
      archive.pipe(output);

      archive.append(JSON.stringify(this.manifest(request), null, 2), { name: 'manifest.json' });
      const processes = await this.sources.processes().catch(() => null);
      archive.append(
        JSON.stringify({ system: this.sources.systemSummary() ?? null, processes }, null, 2),
        { name: 'system.json' },
      );
      const monitors = this.sources
        .monitors()
        .map((monitor) =>
          request.includeHealthHistory ? monitor : { ...monitor, recentResults: [] },
        );
      archive.append(JSON.stringify(monitors, null, 2), { name: 'monitors.json' });
      archive.append(JSON.stringify(this.sources.watches(), null, 2), { name: 'watches.json' });
      archive.append(README, { name: 'README.txt' });
      emit('collect', 40);

      await this.appendOwnLog(
        archive,
        this.sources.agentLogPath,
        'logs/agent.log',
        request.redactAgentLogs,
      );
      if (request.mainLogPath) {
        await this.appendOwnLog(
          archive,
          request.mainLogPath,
          'logs/main.log',
          request.redactAgentLogs,
        );
      }
      emit('collect', 70);

      for (const path of request.extraLogPaths) {
        await this.appendUserLog(archive, path);
      }

      emit('zip', 85);
      await archive.finalize();
      await finished;
      emit('done', 100, { currentItem: stagingPath });
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });
      const shape =
        error instanceof DeskPulseError
          ? error.toShape()
          : { code: ERROR_CODES.INTERNAL, message: String(error), retryable: false };
      emit('failed', 100, { error: shape });
    }
  }

  private manifest(request: ExportRequest): Record<string, unknown> {
    return {
      bundleFormatVersion: BUNDLE_FORMAT_VERSION,
      agentVersion: this.sources.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      createdAt: (this.sources.now?.() ?? new Date()).toISOString(),
      options: {
        includeHealthHistory: request.includeHealthHistory,
        redactAgentLogs: request.redactAgentLogs,
        extraLogCount: request.extraLogPaths.length,
      },
      redactionApplied: request.redactAgentLogs,
    };
  }

  /** DeskPulse's own log: tail to 5 MiB, redacted unless the user opted out. */
  private async appendOwnLog(
    archive: Archiver,
    path: string,
    name: string,
    redact: boolean,
  ): Promise<void> {
    const size = await fileSize(path);
    if (size === 0) {
      archive.append(`(no ${name} captured in this build)\n`, { name });
      return;
    }
    const start = Math.max(0, size - AGENT_LOG_TAIL_BYTES);
    const source = createReadStream(path, { start });
    archive.append(redact ? source.pipe(createRedactStream()) : source, { name });
  }

  /** User-selected log: verbatim, tail to 25 MiB with a truncation marker. */
  private async appendUserLog(archive: Archiver, path: string): Promise<void> {
    const size = (await stat(path)).size; // throws (→ failed export) if unreadable
    const name = `user-logs/${basename(path)}`;
    if (size > USER_LOG_TAIL_BYTES) {
      archive.append(createReadStream(path, { start: size - USER_LOG_TAIL_BYTES }), { name });
      archive.append(
        `Only the last ${USER_LOG_TAIL_BYTES} bytes of ${basename(path)} ` +
          `(${size} bytes total) were included.\n`,
        { name: `${name}.TRUNCATED.txt` },
      );
    } else {
      archive.append(createReadStream(path), { name });
    }
  }
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}
