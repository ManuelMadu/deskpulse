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

## Phase 6 — Menu-bar lifecycle & notifications (M4)

- [ ] Close (red button / ⌘W) hides the window; app stays in menu bar with the agent running.
- [ ] Dock click and tray "Open DeskPulse" both restore and focus the same window.
- [ ] Menu-bar icon shows the three states — nominal, degraded (a monitor unhealthy or a
      watched log errored), agent-down — and stays legible on a light **and** dark menu bar.
- [ ] Tray dropdown lists status, up to five monitors + "n more…", and "Pause all monitors" works.
- [ ] A monitor going unhealthy fires exactly one notification (after `failureThreshold` fails);
      recovery fires one; a wake-induced burst (>3 in 5 s) collapses to one summary banner.
- [ ] Clicking a notification raises the window on the Monitors screen.
- [ ] Unsigned-build caveat holds: banners attribute to "Electron" and may need enabling in
      System Settings › Notifications (matches the README note).
- [ ] Settings › "Open DeskPulse at login" survives a real logout/login; the login start comes
      up hidden (menu-bar only); the toggle reflects the OS value after an external change.
- [ ] Sleep the machine, wake it: metrics/health refresh promptly (no ~45 s stale gap).

## Later phases (placeholders, filled in as features land)

- ⏳ ⌘Q during a diagnostic export prompts once (Phase 8)
- ⏳ `kill -9` of Main leaves no orphan agent (ppid self-check) (Phase 7)
- ⏳ Dark mode across all five screens (Phase 10)
- ⏳ Unsigned-build Gatekeeper walkthrough matches README instructions (Phase 11)
- ⏳ Packaged app on a non-dev account: full UC1–UC7 pass (Phase 11)
