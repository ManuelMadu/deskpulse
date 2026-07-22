import { useEffect, useState } from 'react';

import { api } from '../api.js';
import { DeskPulseError } from '@deskpulse/contracts';

import type { AppSettings } from '@deskpulse/contracts';
import type { ReactElement } from 'react';

/**
 * Settings screen (PDD §13). Launch-at-login is the one MVP setting; the OS is
 * the source of truth, so the toggle always shows the value Main read back
 * after writing, never an optimistic guess.
 */
export function SettingsScreen(): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getSettings()
      .then((value) => {
        if (active) {
          setSettings(value);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof DeskPulseError ? cause.message : 'Could not load settings.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleLaunchAtLogin = async (enabled: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      // Main reports the OS truth after the write; reflect exactly that.
      setSettings(await api.setLaunchAtLogin({ enabled }));
    } catch (cause) {
      setError(cause instanceof DeskPulseError ? cause.message : 'Could not update the setting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-screen">
      <div className="monitors-header">
        <h2 className="screen-title">Settings</h2>
      </div>

      {error && <p className="inline-error">{error}</p>}

      <section className="setting-group" aria-label="Startup">
        <label className="setting-row">
          <input
            type="checkbox"
            data-testid="launch-at-login-toggle"
            checked={settings?.launchAtLogin ?? false}
            disabled={settings === null || saving}
            onChange={(event) => void toggleLaunchAtLogin(event.target.checked)}
          />
          <span className="setting-copy">
            <span className="setting-name">Open DeskPulse at login</span>
            <span className="setting-caveat">
              Starts in the menu bar, hidden, so your monitors are watching from the moment you sign
              in. macOS controls this — DeskPulse shows whatever the system has stored.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
