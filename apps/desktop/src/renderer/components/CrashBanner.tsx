import { useEffect, useState } from 'react';

import { api } from '../api.js';
import { useDashboardStore } from '../store.js';

import type { ReactElement } from 'react';

/**
 * Crash-recovery banner (PDD §7/§28). While the supervisor is restarting the
 * agent it shows a live countdown ("restarting in 4 s… attempt 3/5"); once the
 * automatic attempts are exhausted (`failed`) it offers a manual "Restart
 * agent". Hidden whenever the agent is healthy. Reads the agent status the
 * dashboard already polls.
 */
export function CrashBanner(): ReactElement | null {
  const agent = useDashboardStore((s) => s.agent);
  const [now, setNow] = useState(() => Date.now());
  const state = agent?.state;

  // Tick a local clock while backing off so the countdown stays live between
  // the 2 s status polls.
  useEffect(() => {
    if (state !== 'backoff') {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [state]);

  if (state !== 'backoff' && state !== 'failed') {
    return null;
  }

  if (state === 'failed') {
    return (
      <div className="crash-banner" data-tone="failed" role="alert" data-testid="crash-banner">
        <span className="crash-text">The monitoring agent stopped and couldn’t be restarted.</span>
        <button
          type="button"
          className="crash-action"
          data-testid="restart-agent"
          onClick={() => void api.restartAgent()}
        >
          Restart agent
        </button>
      </div>
    );
  }

  const restart = agent?.restart;
  const secondsLeft =
    restart?.nextRetryAtMs !== undefined
      ? Math.max(0, Math.ceil((restart.nextRetryAtMs - now) / 1000))
      : undefined;
  const attempt = restart ? ` (attempt ${restart.attempt} of ${restart.maxAttempts})` : '';
  const when = secondsLeft !== undefined ? `restarting in ${secondsLeft}s` : 'restarting…';

  return (
    <div className="crash-banner" data-tone="backoff" role="status" data-testid="crash-banner">
      <span className="crash-spinner" aria-hidden="true" />
      <span className="crash-text">
        The monitoring agent stopped — {when}
        {attempt}.
      </span>
    </div>
  );
}
