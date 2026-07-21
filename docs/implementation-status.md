# DeskPulse — Implementation status

Authoritative product spec: [`DeskPulse-PDD.md`](DeskPulse-PDD.md) (v1.0). This file tracks
where the build actually is.

## Current phase

**Phase 3 — System metrics dashboard** (PDD §37). DP-9/DP-10 done; the React Dashboard
UI (stores, polling hooks with visibility pause, gauges/table) remains before M2.
Phases 0–2 complete locally; Phase 0's "CI green on PR" criterion remains outstanding
until the GitHub remote exists (see Blocked items).

## Completed tickets

| Ticket | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Verified by                                                                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DP-1   | Monorepo scaffold: npm workspaces (contracts, system-agent, desktop, e2e), strict TS with project references, ESLint 10 flat config with dependency walls, Prettier, one passing Vitest suite per workspace, esbuild agent bundle skeleton                                                                                                                                                                                                                                                      | `npm ci && npm run typecheck && npm test && npm run lint`                                                                                                                                                                                                       |
| DP-2   | CI pipeline: `ci.yml` on `macos-latest` (lint → depcruise → format → typecheck → agent bundle → tests), dependency-cruiser config enforcing §35 (incl. `no-unresolvable` so a missing exports map can't hide a forbidden edge), commented `windows-latest` placeholder                                                                                                                                                                                                                          | `npm run depcruise` + every ci.yml step run locally; rules probed with deliberate violations                                                                                                                                                                    |
| DP-3   | Electron Forge + Vite shell: locked-down BrowserWindow (`sandbox`, `contextIsolation`, no `nodeIntegration`, window-open denied, navigation locked), CSP injected into built index.html, ZIP+DMG makers, fuses locked except `RunAsNode` (needed for the agent, ADR-0001)                                                                                                                                                                                                                       | `npm start` smoke test (Electron boots, clean teardown, 0 leftover procs); `npm run make` → DeskPulse-0.1.0 ZIP+DMG; CSP verified in built HTML                                                                                                                 |
| DP-4   | Contracts v0: 19 stable error codes + HTTP status map, error envelope schema + `DeskPulseError` class, strict `/health` and `/system` schemas, limits, PDD payloads as JSON fixtures, 18 contract tests (round-trips, unknown-field rejection at every nesting level, edge values)                                                                                                                                                                                                              | `npm test -w @deskpulse/contracts` (18 tests), typecheck, lint, depcruise                                                                                                                                                                                       |
| DP-5   | Agent HTTP bootstrap: `node:http` server bound `127.0.0.1:0`, bearer auth ahead of routing (SHA-256 + `timingSafeEqual`), micro-router with `:param` capture, error-envelope serializer, streaming 64 KiB body cap, authed `GET /health`; bundled agent exits 78 without token                                                                                                                                                                                                                  | 15 agent tests (auth matrix, router, integration: 401/401/200, auth-before-routing, loopback-refusal via real LAN connect, body limit through a live route); bundle smoke: handshake JSON + curl 401/200                                                        |
| DP-6   | Agent lifecycle: handshake schema + exit codes in contracts (`agentReadyHandshakeSchema`, `AGENT_EXIT_CODES`), SIGTERM/SIGINT graceful shutdown with a 2.5 s failsafe, crash-fast unhandled-error handlers, pino JSON logging to `~/Library/Logs/DeskPulse/agent.log` (env-overridable) with 5 MiB × 3-generation rotation                                                                                                                                                                      | Integration tests spawn the real bundle: exit 78 without token, schema-valid handshake + authed /health, SIGTERM → exit 0 < 3 s with port released, structured log content without the token; rotation unit tests                                               |
| DP-7   | Supervisor happy path: Electron-free `AgentSupervisor` (spawn with minimal env + per-spawn 256-bit token, stdout handshake parse, contract-validated `/health` confirm ≤ 10 s, SIGTERM→SIGKILL stop), `resolveAgentBundlePath` (dev vs `process.resourcesPath`), quit orchestration in main, agent bundle as Forge `extraResource`; Playwright E2E harness against the **packaged** app                                                                                                         | 11 desktop tests (handshake parser, real-bundle start/stop, fresh token per spawn, failure classification, SIGKILL fallback — which caught a real resolve-race bug); packaged E2E smoke: sandboxed renderer, agent child present, quit leaves 0 orphans (6.9 s) |
| DP-8   | AgentClient + first IPC slice: undici client (5 s timeouts, contract-parsed responses → `MALFORMED_RESPONSE`, envelope rethrow, `AGENT_UNAVAILABLE`/`REQUEST_TIMEOUT`), `ipcMain.handle` pattern with origin-equality sender check, preload transport exposing frozen `getAgentStatus`/`getSystemSummary` (never `ipcRenderer`), renderer api wrapper converting IpcResult → `DeskPulseError`, proof-of-life status display                                                                     | 9 new desktop tests (client failure-mode matrix over real sockets, sender-check incl. lookalike origins); packaged E2E: `deskPulse` exposed, `ipcRenderer` absent, status line reaches "Agent: running" end-to-end (9.7 s)                                      |
| DP-9   | Metrics sampler + `/system`: pure `computeCpuPercents` over `os.cpus()` tick deltas (clamped ≥ 0 for sleep/wake jumps, 0 % on zero delta, capped at 100 %), `MetricsSampler` with cached 2 s samples and timer teardown owned by the agent's close path, `GET /system` with 503 `NOT_READY` before the first sample                                                                                                                                                                             | 7 unit tests from fixture tick tables (incl. backwards-counter clamp, core-count change), sampler start/stop tests, integration: NOT_READY → contract-valid 200 transition + auth required; packaged E2E asserts live CPU text reaches the renderer (8.2 s)     |
| DP-10  | `ps` process adapter + `/processes`: `execFile('/bin/ps', ['-axo','pid=,pcpu=,rss=,comm='])` — the agent's only child process, fixed binary + array args; parser tolerating comm values with spaces/parentheses, RSS KiB→bytes, per-process CPU > 100 % allowed; 2 s cache sharing one in-flight `ps` across concurrent calls; query validation (limit 1–50, sortBy cpu\|memory, unknown params rejected); first input-validated IPC handler + preload sanity parse + renderer top-process line | 11 new tests: gnarly-comm parser fixtures, sort/limit, cache single-invocation + expiry, integration against real `/bin/ps` (contract-valid, ordering, full invalid-query matrix → 400 envelopes, auth); packaged E2E asserts top-process text end-to-end       |

## Active ticket

**Phase 3 Dashboard UI** (first ten tickets complete): React 18 + Zustand stores, visibility-aware polling hooks (FR-3), CPU gauge + per-core bars, memory bar, top-processes table sortable by CPU/memory, agent status pill.

## Blocked items

- **Pushing `.github/workflows` to GitHub** — the local `gh` token lacks the `workflow` scope.
  Owner action: `gh auth refresh -h github.com -s workflow`, then create the remote and push.
  Workflows are authored and validated locally in the meantime.

## Deferred work

- Universal (arm64+x64) builds — per-arch acceptable for MVP (PDD §34). Dev machine is
  Intel (x64); arm64 artifacts need CI or another machine.
- plugin-vite deprecation warning (`inlineDynamicImports` vs `codeSplitting`) on Vite 7 —
  cosmetic, revisit on the next Forge upgrade.

## Open technical decisions

PDD §41: OD-2…OD-9 open; recommended defaults assumed until the phase that forces each.

- **OD-1 RESOLVED (2026-07-21):** `ELECTRON_RUN_AS_NODE` confirmed in the packaged app —
  the E2E smoke observed the packaged binary running `Resources/agent.cjs` as a separate
  OS process. Requires the `RunAsNode` fuse enabled; `EnableNodeCliInspectArguments` must
  also stay enabled or Playwright cannot attach to the packaged app (ADR-0001).

Resolved so far:

- Package manager: npm workspaces (per PDD; confirmed by owner).
- Bundle ID: `com.manuelmadubugini.deskpulse`. Author: Manuel Madubugini <manuelmadubugini@gmail.com>.
- TypeScript pinned to 5.9.x — TS 7 is out because `typescript-eslint@8.65` supports `<6.1.0` only.
- Commit policy: one scoped commit per ticket, conventional-commit style.
- **PDD §17 refinement:** errors cross the contextBridge as plain `IpcResult` data, and the
  renderer's api wrapper rethrows `DeskPulseError` — Electron strips custom Error fields at
  the bridge, so "rethrow in preload" would lose the structured `code`. Security posture
  unchanged; validation still happens in preload.
- `npm audit`: 0 vulnerabilities in production deps; 25 advisories exist in dev-only
  toolchain chains (Forge → tar/inquirer). Revisit on Forge upgrades.

## Phase acceptance results

Phase 0 "done when": fresh clone → `npm ci && npm test && npm start` works; CI green on PR.

- `npm ci`/`npm install` ✅ (0 vulnerabilities)
- `npm run typecheck` ✅ (tsc -b, all 4 workspaces)
- `npm test` ✅ (4 suites, 6 tests)
- `npm run lint` ✅ (walls verified with deliberate violations)
- `npm start` ✅ (Electron boots the locked-down shell; clean teardown, no orphan processes)
- `npm run make` ✅ (unsigned ZIP + DMG for darwin/x64; CSP present in built index.html)
- CI green ⏳ DP-2 authored, remote push pending `workflow` scope

Phase 1 "done when": `node dist/agent.cjs` (with env token) serves authed `/health`; all listed tests green.

- Bundled agent serves authed `/health` ✅ (verified via curl smoke and spawned-process integration tests)
- Contract tests ✅ (21: envelope, health/system, handshake, unknown-field rejection)
- Agent integration ✅ (21: auth matrix, loopback-only bind, handshake parse, SIGTERM ≤ 3 s, exit codes, log content)

Phase 2 "done when": dev app boots, DevTools shows no Node globals in renderer, quit leaves no orphan agent.

- Dev app boots ✅ (`npm start` smoke, DP-3); packaged app boots ✅ (E2E)
- No Node globals in renderer ✅ (E2E asserts `process`/`require`/`Buffer`/`ipcRenderer` all absent)
- No orphan agent after quit ✅ (E2E pgrep check, 2 consecutive green runs)
- **M1 (Skeleton alive) reached**, with the packaged-build proof (R4/OD-1) done early

## Commands used to verify

```sh
npm install
npm run typecheck   # tsc -b
npm test            # builds refs, then vitest per workspace
npm run lint
node services/system-agent/esbuild.config.mjs  # (from that dir) bundle smoke test
node services/system-agent/dist/agent.cjs      # prints placeholder handshake JSON
```
