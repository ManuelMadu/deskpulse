# DeskPulse — Manual macOS verification checklist

Built incrementally as phases land (PDD §33). Run in full against the **packaged** build
before any release. Items marked ⏳ have no implementation yet.

## Phase 0

- [ ] Fresh clone on a second account/machine: `npm ci && npm test` succeeds with Node ≥ 20.

## Later phases (placeholders, filled in as features land)

- ⏳ Menu-bar icon states (nominal / degraded / agent-down), light & dark menu bar (Phase 6)
- ⏳ Notification appearance + click routing; unsigned-build attribution caveat (Phase 6)
- ⏳ Launch-at-login across a real logout/login, hidden launch respected (Phase 6)
- ⏳ Close ≠ quit; Dock click and tray "Open DeskPulse" restore the window (Phase 6)
- ⏳ ⌘Q during a diagnostic export prompts once (Phase 8)
- ⏳ `kill -9` of Main leaves no orphan agent (ppid self-check) (Phase 7)
- ⏳ Dark mode across all five screens (Phase 10)
- ⏳ Unsigned-build Gatekeeper walkthrough matches README instructions (Phase 11)
- ⏳ Packaged app on a non-dev account: full UC1–UC7 pass (Phase 11)
