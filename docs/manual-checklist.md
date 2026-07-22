# DeskPulse — Manual macOS verification checklist

Built incrementally as phases land (PDD §33). Run in full against the **packaged** build
before any release. Items marked ⏳ have no implementation yet.

## Phase 0

- [ ] Fresh clone on a second account/machine: `npm ci && npm test` succeeds with Node ≥ 20.

## Phase 3 — Dashboard (M2)

- [ ] Dashboard values are sane vs Activity Monitor (CPU %, memory, top processes).
- [ ] Hidden window generates no `/processes` traffic (agent request log).

## Phase 4 — Log watching (M3)

- [ ] Open a log via the native picker; appended lines appear within ~1 s.
- [ ] `mv app.log app.log.1 && touch app.log` (rotate) → "— rotated —" marker, tailing continues.
- [ ] `: > app.log` (truncate) → "— truncated —" marker, tailing resumes from 0.
- [ ] `rm app.log` then recreate → "— file deleted… —" then resumed tailing.
- [ ] A `/var/log` file that yields EACCES shows an inline permission error.
- [ ] `yes >> app.log` flood keeps the UI responsive; drop counter appears.

## Phase 5 — Service monitoring

- [ ] Add a monitor for a running local service → chip reaches Healthy.
- [ ] Stop the service → chip flips to Unhealthy after `failureThreshold` probes.
- [ ] Restart the service → chip returns to Healthy after `recoveryThreshold` probes.
- [ ] Pause a monitor → chip shows Paused, probing stops; Resume restarts it.
- [ ] Add/edit sheet rejects a non-loopback URL and out-of-range interval inline.

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
