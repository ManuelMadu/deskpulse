/**
 * Renderer entry. Sandboxed: no Electron, no Node built-ins (lint-enforced).
 * The React app replaces this from Phase 3; for now it proves the Vite
 * pipeline and the sandbox by rendering entirely with DOM APIs.
 */

const root = document.getElementById('app');

if (root) {
  const heading = document.createElement('h1');
  heading.textContent = 'DeskPulse';

  const status = document.createElement('p');
  status.textContent = 'Shell online — Phase 0. Agent supervision arrives in Phase 2.';

  root.append(heading, status);
}

export {};
