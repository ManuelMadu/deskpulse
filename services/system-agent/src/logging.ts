import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { destination, pino } from 'pino';

import type { Logger } from 'pino';

export const LOG_FILE_NAME = 'agent.log';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_GENERATIONS = 3; // agent.log + .1 + .2 (PDD §32, OD-7)
const SIZE_CHECK_INTERVAL_MS = 10_000;

export interface AgentLoggerOptions {
  /** Overridable for tests; defaults to ~/Library/Logs/DeskPulse. */
  dir?: string;
  maxBytes?: number;
  generations?: number;
}

export interface AgentLogging {
  logger: Logger;
  logFilePath: string;
  /** Flush synchronously and stop the rotation timer. Safe to call twice. */
  close(): void;
}

export function defaultLogDir(): string {
  return join(homedir(), 'Library', 'Logs', 'DeskPulse');
}

/**
 * Shift agent.log → agent.log.1 → agent.log.2, dropping the oldest.
 * Exported for direct unit testing with tiny limits.
 */
export function rotateGenerations(filePath: string, generations: number): void {
  for (let i = generations - 1; i >= 1; i -= 1) {
    const source = i === 1 ? filePath : `${filePath}.${i - 1}`;
    if (existsSync(source)) {
      renameSync(source, `${filePath}.${i}`);
    }
  }
}

function sizeOf(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * pino → SonicBoom file destination with size-based rotation: rename at the
 * cap, keep N generations, reopen the destination (PDD §32). Content
 * discipline is the caller's job: never the token, never user log lines.
 */
export function createAgentLogging(options: AgentLoggerOptions = {}): AgentLogging {
  const dir = options.dir ?? process.env['DESKPULSE_AGENT_LOG_DIR'] ?? defaultLogDir();
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const generations = options.generations ?? DEFAULT_GENERATIONS;
  const logFilePath = join(dir, LOG_FILE_NAME);

  mkdirSync(dir, { recursive: true });
  if (sizeOf(logFilePath) > maxBytes) {
    rotateGenerations(logFilePath, generations);
  }

  // Synchronous destination: the agent's own log volume is tiny (state
  // transitions and errors, never user log lines), and sync writes make
  // rotation + shutdown flushing race-free.
  const dest = destination({ dest: logFilePath, sync: true, mkdir: true });
  const logger = pino(
    {
      base: { proc: 'agent', pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    dest,
  );

  const timer = setInterval(() => {
    if (sizeOf(logFilePath) > maxBytes) {
      dest.flushSync();
      rotateGenerations(logFilePath, generations);
      dest.reopen();
    }
  }, SIZE_CHECK_INTERVAL_MS);
  timer.unref();

  let closed = false;
  return {
    logger,
    logFilePath,
    close() {
      if (closed) {
        return;
      }
      closed = true;
      clearInterval(timer);
      try {
        dest.flushSync();
      } catch {
        // flushing on teardown is best-effort; the fd is closing anyway
      }
    },
  };
}
