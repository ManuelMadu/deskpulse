/**
 * Renderer proof-of-life (DP-8). Sandboxed: no Electron, no Node — only the
 * frozen window.deskPulse surface. The React app replaces this in Phase 3;
 * this exists to prove the full renderer → preload → Main → agent path,
 * including typed structured errors.
 */
import { DeskPulseError } from '@deskpulse/contracts';

import { api } from './api.js';

const root = document.getElementById('app');

function render(agentLine: string, systemLine: string, processLine: string): void {
  if (!root) {
    return;
  }
  root.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = 'DeskPulse';

  const agentStatus = document.createElement('p');
  agentStatus.id = 'agent-status';
  agentStatus.textContent = agentLine;

  const systemStatus = document.createElement('p');
  systemStatus.id = 'system-status';
  systemStatus.textContent = systemLine;

  const topProcess = document.createElement('p');
  topProcess.id = 'top-process';
  topProcess.textContent = processLine;

  root.append(heading, agentStatus, systemStatus, topProcess);
}

let lastSystemLine = 'Metrics: waiting for agent…';
let lastProcessLine = 'Top process: waiting…';

async function refresh(): Promise<void> {
  let agentLine: string;
  try {
    const status = await api.getAgentStatus();
    agentLine = `Agent: ${status.state}${status.pid ? ` (pid ${status.pid}, v${status.version ?? '?'})` : ''}`;
  } catch (error) {
    agentLine = `Agent: error — ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const summary = await api.getSystemSummary();
    lastSystemLine = `CPU ${summary.cpu.overallPercent.toFixed(1)}% · ${summary.cpu.perCorePercent.length} cores`;
  } catch (error) {
    lastSystemLine =
      error instanceof DeskPulseError
        ? `Metrics: not available yet (${error.code})`
        : `Metrics: ${String(error)}`;
  }

  try {
    const { processes } = await api.getProcesses({ limit: 1, sortBy: 'cpu' });
    const top = processes[0];
    lastProcessLine = top
      ? `Top process: ${top.name} — ${top.cpuPercent.toFixed(1)}% CPU`
      : 'Top process: none reported';
  } catch (error) {
    lastProcessLine =
      error instanceof DeskPulseError
        ? `Top process: unavailable (${error.code})`
        : `Top process: ${String(error)}`;
  }

  render(agentLine, lastSystemLine, lastProcessLine);
}

void refresh();
setInterval(() => void refresh(), 2_000);

export {};
