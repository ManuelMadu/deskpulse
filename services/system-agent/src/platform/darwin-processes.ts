import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import { DeskPulseError, ERROR_CODES } from '@deskpulse/contracts';

import type { ProcessInfo, ProcessQuery, ProcessesResponse } from '@deskpulse/contracts';

const execFileAsync = promisify(execFile);

/**
 * The ONLY child process the agent ever spawns: a fixed absolute binary with
 * array args — no shell, no interpolation, no injection surface (PDD §26, §30).
 */
const PS_BINARY = '/bin/ps';
const PS_ARGS = ['-axo', 'pid=,pcpu=,rss=,comm='] as const;
const PS_TIMEOUT_MS = 3_000;
const PS_MAX_BUFFER = 1024 * 1024;
const CACHE_MS = 2_000;

export type PsExec = () => Promise<{ stdout: string }>;

async function defaultPsExec(): Promise<{ stdout: string }> {
  try {
    return await execFileAsync(PS_BINARY, PS_ARGS, {
      timeout: PS_TIMEOUT_MS,
      maxBuffer: PS_MAX_BUFFER,
    });
  } catch (error) {
    const stderr =
      typeof (error as { stderr?: unknown }).stderr === 'string'
        ? ((error as { stderr: string }).stderr ?? '').slice(0, 1024)
        : undefined;
    throw new DeskPulseError({
      code: ERROR_CODES.INTERNAL,
      message: 'Failed to list processes.',
      details: { ...(stderr !== undefined ? { stderr } : {}), cause: String(error) },
      retryable: true,
    });
  }
}

/**
 * Parse `ps -axo pid=,pcpu=,rss=,comm=` output. The first three columns are
 * numeric; everything after the third column is `comm` verbatim — it may
 * contain spaces and parentheses ("...Chrome Helper (Renderer)"). Lines that
 * don't parse are skipped (zombies occasionally render oddly), never fatal.
 */
export function parsePsOutput(stdout: string): ProcessInfo[] {
  const processes: ProcessInfo[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const cpuPercent = Number(match[2]);
    const rssKiB = Number(match[3]);
    const comm = match[4]!.trim();
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(cpuPercent) || comm.length === 0) {
      continue;
    }
    processes.push({
      pid,
      name: basename(comm),
      cpuPercent: Math.max(0, cpuPercent),
      memoryRssBytes: Math.max(0, rssKiB) * 1024,
    });
  }
  return processes;
}

export function sortAndLimit(processes: ProcessInfo[], query: ProcessQuery): ProcessInfo[] {
  const key = query.sortBy === 'memory' ? 'memoryRssBytes' : 'cpuPercent';
  return [...processes].sort((a, b) => b[key] - a[key]).slice(0, query.limit);
}

export interface ProcessProvider {
  list(query: ProcessQuery): Promise<ProcessesResponse>;
}

/**
 * 2 s result cache: concurrent GET /processes calls share one in-flight ps
 * invocation; sort/limit are applied per query over the cached snapshot.
 */
export function createDarwinProcessProvider(
  exec: PsExec = defaultPsExec,
  cacheMs: number = CACHE_MS,
): ProcessProvider {
  let cached: { at: number; sampledAt: string; processes: ProcessInfo[] } | undefined;
  let inFlight: Promise<{ sampledAt: string; processes: ProcessInfo[] }> | undefined;

  async function snapshot(): Promise<{ sampledAt: string; processes: ProcessInfo[] }> {
    if (cached && Date.now() - cached.at < cacheMs) {
      return cached;
    }
    inFlight ??= exec()
      .then(({ stdout }) => {
        const fresh = {
          at: Date.now(),
          sampledAt: new Date().toISOString(),
          processes: parsePsOutput(stdout),
        };
        cached = fresh;
        return fresh;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    async list(query) {
      const { sampledAt, processes } = await snapshot();
      return { sampledAt, processes: sortAndLimit(processes, query) };
    },
  };
}
