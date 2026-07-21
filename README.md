# DeskPulse

macOS menu-bar app for local diagnostics: live CPU/memory/process metrics, rotation-safe
log tailing, HTTP health checks for local services with native notifications, and one-click
diagnostic bundle export.

The point of the project is the **architecture**, not the pixels: a sandboxed Electron
renderer talks through a narrow `contextBridge` API to the Electron main process, which
supervises a **standalone Node.js system agent** over an authenticated, loopback-only
HTTP + SSE API. Three real OS processes, real supervision (readiness handshake, crash
detection, capped exponential backoff), real filesystem edge-case handling.

```text
Electron renderer — React + TypeScript (sandboxed, no Node)
        │  window.deskPulse.* (contextBridge)
        ▼
Electron main process — windows, tray, dialogs, notifications,
        │               persistence, agent supervision
        │  Bearer-authenticated HTTP + SSE on 127.0.0.1
        ▼
system-agent — standalone Node.js process
        (metrics, log tailing, health probes, diagnostics)
```

Full design: see [docs/DeskPulse-PDD.md](docs/DeskPulse-PDD.md).

## Status

Phases 0–4 complete (tooling, agent, secure IPC, metrics dashboard, log watching);
milestone M3 (trustworthy tailing) reached. See
[docs/implementation-status.md](docs/implementation-status.md).

## Requirements

- macOS 13+
- Node.js ≥ 20, npm ≥ 10

## Getting started

```sh
npm ci
npm test            # typecheck + all workspace test suites
npm run lint
```

`npm start` opens the dev app (Vite HMR renderer). `npm run make` produces unsigned ZIP+DMG artifacts in `apps/desktop/out/make/`.

## Repository layout

```text
apps/desktop/           Electron app: src/main, src/preload, src/renderer
services/system-agent/  Standalone Node agent (esbuild → dist/agent.cjs)
packages/contracts/     Zod schemas + types shared across process boundaries
tests/e2e/              Playwright Electron E2E suite (from Phase 2)
docs/                   Implementation status, ADRs, manual checklist
```

Dependency rules are enforced by lint + CI: `contracts` imports nothing local and no
Node/Electron runtime; the agent never imports Electron or desktop code; the desktop app
never imports agent _source_ (it spawns the built bundle); the renderer imports neither
Node nor Electron.

## License

MIT
