# ADR-0001 — Phase 0 toolchain pins and Forge layout

**Date:** 2026-07-21 · **Status:** Accepted

## Context

Phase 0 (DP-1…DP-3) fixes the toolchain the whole project builds on. Several
current package majors are mutually incompatible, and the PDD's repo sketch
places `forge.config.ts` at the repo root while Forge must run from the
workspace that owns the `electron` dependency.

## Considered options

1. Latest everything (TypeScript 7, Vite 8, `@electron/fuses` 2).
2. Verified-compatible set, pinned via peer-dependency evidence.

## Decision

Option 2:

- **TypeScript ~5.9.3** — `typescript-eslint@8.65` supports `>=4.8.4 <6.1.0`;
  TS 7 (and 6.1+) is out until typescript-eslint catches up.
- **Vite ^7 in `apps/desktop`** — `@electron-forge/plugin-vite@7.11.2` predates
  Vite 8; Vitest 4.1 accepts Vite ^6/^7/^8, so the root test toolchain is unaffected.
- **`@electron/fuses` ^1.8** — `plugin-fuses@7.11.2` peers on `^1.0.0`.
- **`forge.config.ts` lives in `apps/desktop/`**, not the repo root (PDD §35
  sketch adjusted): Forge resolves `electron` and the Vite configs relative to
  the package it runs in; root `npm start`/`npm run make` delegate via
  `npm -w @deskpulse/desktop`.
- **Fuses: `RunAsNode` stays enabled** — the Forge template disables it, but the
  agent strategy (PDD OD-1) launches the bundled agent with
  `ELECTRON_RUN_AS_NODE=1`. All other fuses keep the template's locked values.
  Final OD-1 sign-off still requires the packaged-build spike (end of Phase 2).

## Consequences

- Upgrades to TS 6/7 and Vite 8 are deliberate future events, revisited when
  typescript-eslint and plugin-vite support them.
- Anyone running Forge commands must do so via the root scripts or `-w
@deskpulse/desktop`, never from the repo root directly.
- Keeping `RunAsNode` enabled means any local process can run the app binary in
  Node mode — identical to stock Electron's posture and inside the PDD §30
  threat model (we don't defend against same-user local processes).
