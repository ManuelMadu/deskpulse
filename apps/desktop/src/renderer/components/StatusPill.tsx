import type { AgentStatus } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

const STATE_LABEL: Record<
  AgentStatus['state'],
  { label: string; tone: 'ok' | 'warn' | 'fail' | 'rest' }
> = {
  running: { label: 'Running', tone: 'ok' },
  spawning: { label: 'Starting…', tone: 'warn' },
  backoff: { label: 'Restarting…', tone: 'warn' },
  stopping: { label: 'Stopping…', tone: 'warn' },
  failed: { label: 'Failed', tone: 'fail' },
  stopped: { label: 'Stopped', tone: 'rest' },
  idle: { label: 'Starting…', tone: 'rest' },
};

/** Agent status: dot + word, never color alone (PRODUCT.md honest states). */
export function StatusPill({ agent }: { agent: AgentStatus | undefined }): ReactElement {
  const { label, tone } = agent ? STATE_LABEL[agent.state] : STATE_LABEL.idle;
  return (
    <span className="status-pill" data-tone={tone} data-testid="agent-pill">
      <span className="dot" aria-hidden="true" />
      <span>
        Agent {label.toLowerCase()}
        {agent?.pid !== undefined && agent.state === 'running' ? ` · ${agent.pid}` : ''}
      </span>
    </span>
  );
}
