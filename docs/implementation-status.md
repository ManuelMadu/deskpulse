# DeskPulse — Implementation status

Authoritative product spec: [`DeskPulse-PDD.md`](DeskPulse-PDD.md) (v1.0). This file tracks
where the build actually is.

## Current phase

**Phase 8 — Diagnostic export — COMPLETE** (PDD §20/§27). A single-flight, streaming
exporter builds a ZIP (manifest/system/monitors/watches JSON, DeskPulse logs tailed to
5 MiB and secret-redacted, user logs verbatim tailed to 25 MiB) with byte-weighted
`diagnostics.progress` events; disk preflight refuses when free < 2× estimate, and any
failure leaves no staging residue. POST /diagnostics/export drives it; Main moves the
finished ZIP to ~/Downloads and reveals it in Finder. A Diagnostics screen exposes the
toggles and a live progress bar. **Milestone M5 complete.** Next up is Phase 9
(persistence & settings).

Phases 0–8 complete locally, **pushed to GitHub (private), CI green on `main`.**

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

| P3-UI | Dashboard UI: React 19 + Zustand + hand-rolled visibility-aware `usePolling` (2 s, zero traffic while hidden, FR-3); sidebar shell + agent status pill (dot + words, never color alone); CPU big numeral + per-core threshold-tinted bars, memory bar with "approx. used" caveat, host facts; server-sorted process table (`aria-sort`); honest NOT_READY/error/retry states; design system in PRODUCT.md/DESIGN.md (OKLCH amber-tinted neutrals, light+dark, reduced-motion) | 8 formatter/threshold unit tests; packaged E2E: pill, CPU %, process rows, no orphans (8.8 s) |
| P4-a…g | **Phase 4 log watching** (7 tasks): SSE event union + watch/logs-IPC contracts; agent EventBus (500-event replay ring, monotonic ids) + `GET /events` (heartbeat, Last-Event-ID replay, `stream.reset`, drop-then-close backpressure, 2-connection cap) + UUIDv7; **Tailer** §24 state machine (open-fd offset reads, inode+device identity, dir watch + 1 s poll; append/truncate/rotate/delete/EACCES; raw-byte encoding-safe LineSplitter, 32 KiB cap, 500 lines/s rate cap); `WatchRegistry` + `POST/DELETE /watch` (5-watch limit, errno→envelope); Main `AgentEventConsumer` (1→10 s reconnect, 45 s staleness, frame validation) + event bridge; path-token registry + native dialog + MRU (renderer never sees a real path); Logs UI (virtualized 5,000-line ring buffer, auto-scroll pin, filter, inline markers, drop notice, ANSI-stripped text-only) | **77 new tests** across the layers; the full filesystem suite (append, backfill+1 MiB cap, monotonic offsets, truncate, logrotate rename+recreate with zero lost lines, delete+recreate, window expiry, 32 KiB capping, 10k-line flood accounting, permissions); SSE + /watch integration over real streams; packaged **E2E flow 2** (open temp log → append → visible ≤ 5 s → no orphan) |
| P8-a…e | **Phase 8 diagnostic export** (5 tasks): diagnostics contracts (progress event, export request/response — main-process log passed as a temp-file path, not base64, to respect the 64 KiB body cap) + FR-23 secret redactor (pure per-line filter + chunk-boundary-safe Transform); single-flight streaming `DiagnosticsExporter` (archiver, injected sources, disk preflight → INSUFFICIENT_SPACE, fail→staging-cleanup); POST /diagnostics/export wired into the agent from its live subsystems (archiver dynamic-imported so esbuild bundles it, pinned v6); Main IPC + move-to-Downloads-on-done + Finder reveal; Diagnostics screen (redact/history toggles, live progress) | **44 new tests** (redactor hit/near-miss/split table, exporter build→unzip→entries + redaction + verbatim user log + unreadable→failed-no-residue + disk refusal + single-flight, route 202/401/400 over real HTTP, finalizeExport rename+cleanup, contract round-trips); packaged **E2E flow 5** (Export → progress done → deskpulse-diagnostics-*.zip in Downloads with manifest.json + logs/agent.log → no orphan) |
| P7-a…d | **Phase 7 agent crash recovery** (4 tasks): supervisor §28 state machine (`launch`/`restart`/exit-watcher over the `start`/`stop` primitives) with a pure, table-tested backoff ladder + rolling-window `failed` rule + stable-running reset, every transition pushed via `onStateChange`; agent ppid orphan self-check (self-terminate when reparented to launchd, injectable + unit-tested); reconciliation — an in-memory `AgentConfigStore` mirrors every monitor/watch IPC write, and on any post-boot `running` the supervisor re-pushes them to the fresh agent and sends the renderer an old→new watch remap (new typed `reconcile` channel) so open log views re-key and keep streaming; crash-recovery banner (live countdown from `AgentStatus.restart.nextRetryAtMs` + manual "Restart agent" via `agent:restart` IPC) | **31 new tests** (backoff/rolling-window table, real-bundle kill→recover + failed-budget→manual-restart integration, orphan-guard transitions, config-store merge, reconciler re-push+remap+best-effort-skip, reconcile/restart contracts); packaged **E2E flow 4** (kill -9 the agent mid-watch → restart marker → new agent supervising → fresh append streams through → no orphan) |
| P6-a…d | **Phase 6 menu-bar lifecycle & notifications** (4 tasks): hide-on-close lifecycle (`windows.ts` create/reveal + close→hide guard; `app-lifecycle.ts` activate-reveals, `window-all-closed` no-quit, sleep-resume SSE reconnect, hidden login-item launch, quit orchestration); menu-bar `Tray` with three template-image states (nominal / degraded / agent-down, silhouette-distinguished so macOS tints them) + dropdown (status line, ≤5 monitors + "n more…", Open / Pause all / Quit), driven by a pure `HealthState` distilled from the forwarded event stream and a pure `tray-model`; native monitor notifications from Main (pure `NotificationPolicy`: transition-only + >3-in-5 s coalescing; `MonitorNotifier` with injected presenter; click routes to Monitors via a new typed Main→renderer `navigate` channel); launch-at-login (`LaunchAtLoginController` over an injected login-item gateway, OS read-back is truth) + settings IPC + live Settings screen | **34 new tests** (health-state derivation, tray-model wording/overflow, notification-policy fake-clock coalescing, notifier wiring + click routing, launch-at-login incl. MDM refusal, navigation + settings contracts); packaged **smoke flow extended**: close hides window while the agent survives, activate reveals it, a `navigate` push switches to Monitors, and the Settings toggle hydrates from Main |
| P5-a…e | **Phase 5 health monitoring** (5 tasks): monitor config/patch/status + `monitor.*` event contracts with loopback-only URL validation (regex, no URL global; rejects userinfo/subdomain bypasses); pure `MonitorStateMachine` (threshold-gated transitions); `probeOnce` (undici + hard abort, ≤ 4 KiB drain, no redirects, failure classification); `HealthRegistry` (per-monitor scheduler, 0-2 s jitter, overlap-skip → warning, 100-result history, 20-monitor cap, reset on url/method/status change); `GET/POST/PATCH/DELETE /monitors`; monitors IPC + AgentClient `patch`; monitors store (snapshot + `monitor.*` incremental, unknown→healthy on first ok); Monitors UI (status chip, latency, last-checked, 20-tick sparkline, pause/edit/delete, add/edit sheet validating via the contract schema itself) | **50 new tests**: full FR-11 transition matrix, probe classification (ok/unexpected-status/connection-refused/timeout) vs a mode-switch fixture, unhealthy-after-exactly-threshold + recovery, slow-monitor independence, overlap warning, CRUD matrix + limit + reset, store ingestion; packaged **E2E flow 3** (add monitor → fail service → Unhealthy chip → restore → Healthy chip → no orphan) |

## Active ticket

**Phase 9 — Persistence & settings** (atomic JSON store; monitors/settings/MRU/window-state persistence; startup restore → durable config across app restarts, FR-24/25). Manual sanity vs Activity Monitor (M2), scripted tailing demo (M3), the Phase 6 macOS items (tray appearance, real login item, notification center), the Phase 7 `kill -9` of _Main_ orphan check, and the Phase 8 Archive-Utility/redaction spot-check still to be run by hand.

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
- **React 19** (PDD §18 says "React 18", written pre-19-stable): all planned deps
  (zustand 5, @tanstack/react-virtual) support 19; `@vitejs/plugin-react` pinned to 5.x
  (6.x needs Vite 8). Root `vite` pinned ~7.3.6 so one Vite serves Vitest and Forge.
- Design context lives in `PRODUCT.md` + `DESIGN.md` (impeccable skill); OD-9 resolved:
  hand-rolled `usePolling`, no TanStack Query.

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

Phase 4 "done when": logrotate-style rename+recreate mid-stream produces a `rotated` marker
and continuous tailing with zero lost lines in the fs test.

- Full filesystem suite ✅ (rotation with zero lost lines asserted directly against the Tailer)
- SSE + /watch integration ✅ (real streams: replay, reset, backpressure cap, watch limit/errors)
- E2E flow 2 ✅ (open temp log → append → visible in viewer → no orphan)
- **M3 (Trustworthy tailing) reached.** 162 unit/integration tests + 2 packaged E2E flows green.
- Remaining by hand: scripted rotate/truncate/delete demo against the live UI (manual checklist).

Phase 6 "done when" (M4): window close leaves a tray-resident app, activate restores it, a
monitor going unhealthy fires exactly one notification (after `failureThreshold` fails)
whose click opens Monitors, and recovery fires one notification.

- Hide-on-close + activate-restore ✅ (packaged smoke asserts close hides the window, the
  agent survives, activate reveals it; `window-all-closed` no longer quits on darwin)
- Tray with three template-image states + dropdown ✅ (pure `HealthState`/`tray-model`
  unit-tested; wired to the same forwarded event stream the renderer consumes)
- Transition-only notifications + coalescing ✅ (pure `NotificationPolicy` fake-clock tests:
  ≤3 fire individually, >3-in-5 s → one summary; notifier click routes to Monitors)
- Notification click routing ✅ (typed Main→renderer `navigate` channel; smoke drives the
  push directly and asserts the renderer switches to Monitors)
- Launch-at-login ✅ (OS-read-back controller unit-tested; live Settings toggle, smoke
  confirms it hydrates from Main)
- **M4 (Resident menu-bar app) reached.** ~229 unit/integration tests + 3 packaged E2E flows green.
- Remaining by hand (macOS-only, not automatable): tray legibility on light/dark bars, real
  notification appearance + unsigned "Electron" attribution, login item across a real
  logout/login with hidden start, sleep/wake refresh (manual checklist).

Phase 7 "done when": `kill -9 <agent-pid>` during an active watch recovers to streaming
within the backoff budget, the log view shows the restart marker, no orphan processes
after quit; plus a 6th restart in 60s → failed state + working manual restart.

- Backoff ladder + rolling-window failed + stable reset ✅ (pure module, table-tested)
- Real-bundle crash recovery ✅ (integration: kill the agent → back to running with a new pid)
- Failed budget + manual restart ✅ (integration: bad bundle → failed → restart() re-enters spawn)
- Reconciliation ✅ (re-push monitors/watches, old→new watch remap, best-effort skip; unit-tested)
- Orphan self-check ✅ (agent exits on ppid→1; injectable, unit-tested)
- E2E flow 4 ✅ (packaged: kill -9 mid-watch → "— agent restarted, resuming —" → new agent →
  fresh append streams → no orphan, 6.7 s)
- **M5's crash half reached.** ~248 unit/integration tests + 4 packaged E2E flows green.
- Remaining by hand: `kill -9` of _Main_ leaves no orphan agent (ppid self-check, ~5 s).

Phase 8 "done when": the exported ZIP opens in Archive Utility with all documented
entries; a failed export leaves no temp files.

- Streaming pipeline + all entries ✅ (exporter integration: build → unzip → manifest/
  system/monitors/watches/README/logs asserted present)
- Redaction ✅ (FR-23 pattern table; agent log redacted, user log verbatim in the bundle)
- Failure cleanup ✅ (unreadable extra log → failed event + staging dir gone; disk preflight)
- HTTP surface ✅ (POST /diagnostics/export 202/401/400 over real sockets)
- Move-to-Downloads ✅ (finalizeExport rename+cleanup unit-tested; Main reveals in Finder)
- E2E flow 5 ✅ (packaged: Export → done → deskpulse-diagnostics-\*.zip in Downloads with
  manifest.json + logs/agent.log → no orphan)
- **M5 (Resilient) complete.** ~277 unit/integration tests + 5 packaged E2E flows green.
- Remaining by hand: open a real bundle in Archive Utility and eyeball redaction (checklist).

## Commands used to verify

```sh
npm install
npm run typecheck   # tsc -b
npm test            # builds refs, then vitest per workspace
npm run lint
node services/system-agent/esbuild.config.mjs  # (from that dir) bundle smoke test
node services/system-agent/dist/agent.cjs      # prints placeholder handshake JSON
```

- **Known flake:** E2E flow 2 (log append visibility) flakes ~1 in 3 and passes on the
  single retry; targeted for the Phase 10 deflake pass. Flow 3 process-orphan checks now
  isolate each app instance so sibling-test residue no longer fails a run.
