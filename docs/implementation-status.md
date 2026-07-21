# DeskPulse — Implementation status

Authoritative product spec: [`DeskPulse-PDD.md`](DeskPulse-PDD.md) (v1.0). This file tracks
where the build actually is.

## Current phase

**Phase 0 — Repository and tooling setup** (PDD §37)

## Completed tickets

| Ticket | Summary                                                                                                                                                                                                                                    | Verified by                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| DP-1   | Monorepo scaffold: npm workspaces (contracts, system-agent, desktop, e2e), strict TS with project references, ESLint 10 flat config with dependency walls, Prettier, one passing Vitest suite per workspace, esbuild agent bundle skeleton | `npm ci && npm run typecheck && npm test && npm run lint` |
| DP-2   | CI pipeline: `ci.yml` on `macos-latest` (lint → depcruise → format → typecheck → agent bundle → tests), dependency-cruiser config enforcing §35 (incl. `no-unresolvable` so a missing exports map can't hide a forbidden edge), commented `windows-latest` placeholder | `npm run depcruise` + every ci.yml step run locally; rules probed with deliberate violations |

## Active ticket

**DP-3 — Electron Forge + Vite shell**: hello-world window with `sandbox:true`, `contextIsolation:true`, CSP, navigation lock; `npm start` and `npm run make` both work.

## Blocked items

- **Pushing `.github/workflows` to GitHub** — the local `gh` token lacks the `workflow` scope.
  Owner action: `gh auth refresh -h github.com -s workflow`, then create the remote and push.
  Workflows are authored and validated locally in the meantime.

## Deferred work

- Playwright Electron E2E harness (Phase 2+; `tests/e2e` currently holds a Vitest placeholder).
- Forge + Vite integration (DP-3).
- Universal (arm64+x64) builds — per-arch acceptable for MVP (PDD §34).

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
- `npm start` ⏳ arrives with DP-3 (Forge + Vite shell)
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
