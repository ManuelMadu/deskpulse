# DeskPulse — Implementation status

Authoritative product spec: [`DeskPulse-PDD.md`](DeskPulse-PDD.md) (v1.0). This file tracks
where the build actually is.

## Current phase

**Phase 1 — Shared contracts and agent bootstrap** (PDD §37).
Phase 0 complete locally; its "CI green on PR" criterion remains outstanding until the
GitHub remote exists (see Blocked items).

## Completed tickets

| Ticket | Summary                                                                                                                                                                                                                                                                   | Verified by                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DP-1   | Monorepo scaffold: npm workspaces (contracts, system-agent, desktop, e2e), strict TS with project references, ESLint 10 flat config with dependency walls, Prettier, one passing Vitest suite per workspace, esbuild agent bundle skeleton                                | `npm ci && npm run typecheck && npm test && npm run lint`                                                                                       |
| DP-2   | CI pipeline: `ci.yml` on `macos-latest` (lint → depcruise → format → typecheck → agent bundle → tests), dependency-cruiser config enforcing §35 (incl. `no-unresolvable` so a missing exports map can't hide a forbidden edge), commented `windows-latest` placeholder    | `npm run depcruise` + every ci.yml step run locally; rules probed with deliberate violations                                                    |
| DP-3   | Electron Forge + Vite shell: locked-down BrowserWindow (`sandbox`, `contextIsolation`, no `nodeIntegration`, window-open denied, navigation locked), CSP injected into built index.html, ZIP+DMG makers, fuses locked except `RunAsNode` (needed for the agent, ADR-0001) | `npm start` smoke test (Electron boots, clean teardown, 0 leftover procs); `npm run make` → DeskPulse-0.1.0 ZIP+DMG; CSP verified in built HTML |

| DP-4 | Contracts v0: 19 stable error codes + HTTP status map, error envelope schema + `DeskPulseError` class, strict `/health` and `/system` schemas, limits, PDD payloads as JSON fixtures, 18 contract tests (round-trips, unknown-field rejection at every nesting level, edge values) | `npm test -w @deskpulse/contracts` (18 tests), typecheck, lint, depcruise |

## Active ticket

**DP-5 — Agent HTTP bootstrap**: `node:http` server on `127.0.0.1:0`, micro-router, bearer auth middleware (env token, timingSafeEqual), error serializer, `GET /health`; integration tests: 401/200, loopback-only.

## Blocked items

- **Pushing `.github/workflows` to GitHub** — the local `gh` token lacks the `workflow` scope.
  Owner action: `gh auth refresh -h github.com -s workflow`, then create the remote and push.
  Workflows are authored and validated locally in the meantime.

## Deferred work

- Playwright Electron E2E harness (Phase 2+; `tests/e2e` currently holds a Vitest placeholder).
- Universal (arm64+x64) builds — per-arch acceptable for MVP (PDD §34). Dev machine is
  Intel (x64); arm64 artifacts need CI or another machine.
- plugin-vite deprecation warning (`inlineDynamicImports` vs `codeSplitting`) on Vite 7 —
  cosmetic, revisit on the next Forge upgrade.

## Open technical decisions

PDD §41 OD-1…OD-9 all open; recommended defaults assumed until the phase that forces each.
OD-1 (`ELECTRON_RUN_AS_NODE`) must be validated with a packaged-build spike by end of Phase 2.

Resolved so far:

- Package manager: npm workspaces (per PDD; confirmed by owner).
- Bundle ID: `com.manuelmadubugini.deskpulse`. Author: Manuel Madubugini <manuelmadubugini@gmail.com>.
- TypeScript pinned to 5.9.x — TS 7 is out because `typescript-eslint@8.65` supports `<6.1.0` only.
- Commit policy: one scoped commit per ticket, conventional-commit style.

## Phase acceptance results

Phase 0 "done when": fresh clone → `npm ci && npm test && npm start` works; CI green on PR.

- `npm ci`/`npm install` ✅ (0 vulnerabilities)
- `npm run typecheck` ✅ (tsc -b, all 4 workspaces)
- `npm test` ✅ (4 suites, 6 tests)
- `npm run lint` ✅ (walls verified with deliberate violations)
- `npm start` ✅ (Electron boots the locked-down shell; clean teardown, no orphan processes)
- `npm run make` ✅ (unsigned ZIP + DMG for darwin/x64; CSP present in built index.html)
- CI green ⏳ DP-2 authored, remote push pending `workflow` scope

## Commands used to verify

```sh
npm install
npm run typecheck   # tsc -b
npm test            # builds refs, then vitest per workspace
npm run lint
node services/system-agent/esbuild.config.mjs  # (from that dir) bundle smoke test
node services/system-agent/dist/agent.cjs      # prints placeholder handshake JSON
```
