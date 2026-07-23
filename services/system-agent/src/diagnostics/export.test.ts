import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticsExporter } from './export.js';

import type { ExportSources } from './export.js';
import type { AgentEvent, ExportRequest } from '@deskpulse/contracts';

const REQUEST: ExportRequest = {
  includeHealthHistory: true,
  redactAgentLogs: true,
  extraLogPaths: [],
};

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'deskpulse-export-test-'));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

interface Harness {
  sources: ExportSources;
  events: Extract<AgentEvent, { type: 'diagnostics.progress' }>[];
  settled: Promise<void>;
}

function harness(overrides: Partial<ExportSources> = {}): Harness {
  const agentLogPath = join(workDir, 'agent.log');
  if (!existsSync(agentLogPath)) {
    writeFileSync(agentLogPath, 'Authorization: Bearer s3cr3t-token-value\nplain log line\n');
  }
  const events: Extract<AgentEvent, { type: 'diagnostics.progress' }>[] = [];
  let resolve: () => void = () => undefined;
  const settled = new Promise<void>((r) => (resolve = r));
  const sources: ExportSources = {
    version: '0.1.0',
    systemSummary: () => undefined,
    processes: () => Promise.reject(new Error('no ps in test')),
    monitors: () => [],
    watches: () => [],
    agentLogPath,
    tempDir: workDir,
    emit: (event) => {
      if (event.type === 'diagnostics.progress') {
        events.push(event);
        if (event.stage === 'done' || event.stage === 'failed') {
          resolve();
        }
      }
    },
    ...overrides,
  };
  return { sources, events, settled };
}

function unzipList(zip: string): string[] {
  return execFileSync('/usr/bin/unzip', ['-Z1', zip], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}
function unzipEntry(zip: string, entry: string): string {
  return execFileSync('/usr/bin/unzip', ['-p', zip, entry], { encoding: 'utf8' });
}

describe('DiagnosticsExporter', () => {
  it('builds a bundle with all documented entries and redacts the agent log', async () => {
    const { sources, events, settled } = harness();
    const exporter = new DiagnosticsExporter(sources);

    const started = await exporter.start(REQUEST);
    await settled;

    expect(events.at(-1)?.stage).toBe('done');
    const entries = unzipList(started.stagingPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'system.json',
        'monitors.json',
        'watches.json',
        'README.txt',
        'logs/agent.log',
      ]),
    );

    const log = unzipEntry(started.stagingPath, 'logs/agent.log');
    expect(log).toContain('[REDACTED:auth-header]');
    expect(log).not.toContain('s3cr3t-token-value');

    const manifest = JSON.parse(unzipEntry(started.stagingPath, 'manifest.json')) as {
      redactionApplied: boolean;
    };
    expect(manifest.redactionApplied).toBe(true);
  });

  it('includes a user log verbatim (unredacted)', async () => {
    const userLog = join(workDir, 'myapp.log');
    writeFileSync(userLog, 'password=keepme123\n');
    const { sources, settled } = harness();
    const exporter = new DiagnosticsExporter(sources);

    const started = await exporter.start({ ...REQUEST, extraLogPaths: [userLog] });
    await settled;

    const content = unzipEntry(started.stagingPath, 'user-logs/myapp.log');
    expect(content).toContain('password=keepme123'); // never redacted
  });

  it('fails cleanly (no staging residue) when an extra log is unreadable', async () => {
    const { sources, events, settled } = harness();
    const exporter = new DiagnosticsExporter(sources);

    const started = await exporter.start({
      ...REQUEST,
      extraLogPaths: [join(workDir, 'does-not-exist.log')],
    });
    await settled;

    expect(events.at(-1)?.stage).toBe('failed');
    expect(existsSync(dirname(started.stagingPath))).toBe(false);
  });

  it('refuses to start when free disk space is below the estimate', async () => {
    const { sources } = harness({ freeBytes: () => Promise.resolve(1) });
    const exporter = new DiagnosticsExporter(sources);

    await expect(exporter.start(REQUEST)).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(exporter.isRunning).toBe(false);
  });

  it('is single-flight: a second start while running is rejected', async () => {
    const { sources, settled } = harness();
    const exporter = new DiagnosticsExporter(sources);

    const first = exporter.start(REQUEST);
    await expect(exporter.start(REQUEST)).rejects.toMatchObject({ code: 'EXPORT_IN_PROGRESS' });
    await first;
    await settled;
  });
});
