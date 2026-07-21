import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import type { Plugin } from 'vite';

/**
 * Restrictive CSP for the built app (PDD §30). Injected at build time only:
 * the dev server needs its HMR websocket and inline module scripts, and the
 * PDD scopes the requirement to the built index.html.
 */
const CSP = "default-src 'self'";

function injectCsp(): Plugin {
  return {
    name: 'deskpulse-inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), injectCsp()],
});
