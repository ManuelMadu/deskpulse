/** Pure app constants — importable by tests without loading Electron. */
export const APP_BUNDLE_ID = 'com.manuelmadubugini.deskpulse';
export const APP_NAME = 'DeskPulse';

export const WINDOW_DEFAULTS = {
  width: 1000,
  height: 680,
  minWidth: 800,
  minHeight: 560,
} as const;

export function isValidBundleId(id: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(id);
}
