/**
 * Sender-origin verification for every IPC handler (PDD §17, §30): only
 * frames loaded from the app's own renderer may invoke handlers. Pure —
 * takes the frame URL and the allowed origins — so it unit-tests without
 * Electron.
 */
export interface TrustedOrigins {
  /** Vite dev server URL when running under `npm start`, else undefined. */
  devServerUrl: string | undefined;
}

export function isTrustedSenderUrl(frameUrl: string | undefined, origins: TrustedOrigins): boolean {
  if (!frameUrl) {
    return false;
  }
  let frame: URL;
  try {
    frame = new URL(frameUrl);
  } catch {
    return false;
  }
  if (origins.devServerUrl) {
    try {
      // Origin equality, not prefix matching — "localhost:5173" must never
      // trust "localhost:51730".
      if (frame.origin === new URL(origins.devServerUrl).origin) {
        return true;
      }
    } catch {
      // fall through to the packaged check
    }
  }
  // Packaged/production: the renderer is loaded from the app bundle via file://.
  return frame.protocol === 'file:';
}
