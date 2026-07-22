import { monitorConfigInputSchema } from '@deskpulse/contracts';
import { useState } from 'react';

import type { AddMonitorInput, MonitorWithStatus } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

interface FormValues {
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSeconds: string;
  timeoutMs: string;
  statusMin: string;
  statusMax: string;
  failureThreshold: string;
  recoveryThreshold: string;
}

function toValues(monitor: MonitorWithStatus | undefined): FormValues {
  return {
    name: monitor?.name ?? '',
    url: monitor?.url ?? 'http://127.0.0.1:3000/healthz',
    method: monitor?.method ?? 'GET',
    intervalSeconds: String(monitor?.intervalSeconds ?? 30),
    timeoutMs: String(monitor?.timeoutMs ?? 5000),
    statusMin: String(monitor?.expectedStatus.min ?? 200),
    statusMax: String(monitor?.expectedStatus.max ?? 399),
    failureThreshold: String(monitor?.failureThreshold ?? 3),
    recoveryThreshold: String(monitor?.recoveryThreshold ?? 1),
  };
}

/**
 * Add/edit sheet with inline validation mirroring FR-9. The contract schema
 * is the single source of truth: we build the candidate and surface its
 * issues rather than duplicating the rules (PDD §12 "validation mirroring").
 */
export function MonitorForm({
  monitor,
  onSubmit,
  onCancel,
}: {
  monitor: MonitorWithStatus | undefined;
  onSubmit: (input: AddMonitorInput) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [values, setValues] = useState<FormValues>(() => toValues(monitor));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof FormValues, value: string): void =>
    setValues((v) => ({ ...v, [key]: value }));

  const candidate = {
    name: values.name,
    url: values.url,
    method: values.method,
    intervalSeconds: Number(values.intervalSeconds),
    timeoutMs: Number(values.timeoutMs),
    expectedStatus: { min: Number(values.statusMin), max: Number(values.statusMax) },
    failureThreshold: Number(values.failureThreshold),
    recoveryThreshold: Number(values.recoveryThreshold),
    enabled: monitor?.enabled ?? true,
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const parsed = monitorConfigInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[issue.path.join('.')] = issue.message;
      }
      setIssues(next);
      return;
    }
    setIssues({});
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (error) {
      setIssues({ form: error instanceof Error ? error.message : String(error) });
      setSubmitting(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Monitor settings">
      <form className="sheet" onSubmit={(e) => void submit(e)}>
        <h2 className="sheet-title">{monitor ? 'Edit monitor' : 'Add monitor'}</h2>

        <label className="field">
          <span>Name</span>
          <input
            data-testid="monitor-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
          />
          {issues['name'] && <span className="field-error">{issues['name']}</span>}
        </label>

        <label className="field">
          <span>URL (loopback only)</span>
          <input
            data-testid="monitor-url"
            value={values.url}
            onChange={(e) => set('url', e.target.value)}
          />
          {issues['url'] && <span className="field-error">{issues['url']}</span>}
        </label>

        <div className="field-row">
          <label className="field">
            <span>Method</span>
            <select value={values.method} onChange={(e) => set('method', e.target.value)}>
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
            </select>
          </label>
          <label className="field">
            <span>Interval (s)</span>
            <input
              data-testid="monitor-interval"
              value={values.intervalSeconds}
              onChange={(e) => set('intervalSeconds', e.target.value)}
              inputMode="numeric"
            />
            {issues['intervalSeconds'] && (
              <span className="field-error">{issues['intervalSeconds']}</span>
            )}
          </label>
          <label className="field">
            <span>Timeout (ms)</span>
            <input
              value={values.timeoutMs}
              onChange={(e) => set('timeoutMs', e.target.value)}
              inputMode="numeric"
            />
            {issues['timeoutMs'] && <span className="field-error">{issues['timeoutMs']}</span>}
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Status min</span>
            <input
              value={values.statusMin}
              onChange={(e) => set('statusMin', e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>Status max</span>
            <input
              value={values.statusMax}
              onChange={(e) => set('statusMax', e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>Fail after</span>
            <input
              data-testid="monitor-failures"
              value={values.failureThreshold}
              onChange={(e) => set('failureThreshold', e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>Recover after</span>
            <input
              value={values.recoveryThreshold}
              onChange={(e) => set('recoveryThreshold', e.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        {(issues['expectedStatus'] || issues['form']) && (
          <p className="field-error">{issues['expectedStatus'] ?? issues['form']}</p>
        )}

        <div className="sheet-actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={submitting}>
            {monitor ? 'Save' : 'Add monitor'}
          </button>
        </div>
      </form>
    </div>
  );
}
