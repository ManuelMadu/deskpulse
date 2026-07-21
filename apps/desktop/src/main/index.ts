/**
 * Electron main entry. Replaced by the real Forge+Vite entry in DP-3; the
 * security posture there is non-negotiable: sandbox:true, contextIsolation:true,
 * nodeIntegration:false, CSP, navigation lock (PDD §16, §30).
 */
export const APP_BUNDLE_ID = 'com.manuelmadubugini.deskpulse';

export function isValidBundleId(id: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(id);
}
