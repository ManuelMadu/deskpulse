# Design

Seeded pre-implementation (Phase 3 Dashboard). Re-run `/impeccable document` once more
surfaces exist to capture real tokens.

## Theme

Both appearances, following the system (`prefers-color-scheme`), per PDD §12. Scene:
a developer glances at DeskPulse on a second display mid-task, in whatever appearance
their Mac already uses; the app must belong to the OS, not fight it.

Color strategy: **Restrained.** Amber-tinted neutrals + one signal-amber accent under
10% of the surface. Health semantics (healthy/degraded/critical) are functional colors,
not decoration.

## Color palette (OKLCH)

All neutrals tinted toward the accent hue (h ≈ 65). Never #000/#fff.

Light appearance:

- `--bg` oklch(0.975 0.004 65) window background
- `--bg-inset` oklch(0.955 0.005 65) inset panels, table stripes
- `--ink` oklch(0.22 0.008 65) primary text
- `--ink-secondary` oklch(0.45 0.010 65) labels, captions
- `--ink-faint` oklch(0.62 0.010 65) tertiary, disabled
- `--line` oklch(0.88 0.006 65) hairlines (1px)
- `--accent` oklch(0.70 0.145 65) signal amber: focus, active nav, selection
- `--ok` oklch(0.64 0.145 150) healthy
- `--warn` oklch(0.72 0.140 85) degraded / warning
- `--fail` oklch(0.60 0.185 25) unhealthy / error

Dark appearance:

- `--bg` oklch(0.205 0.008 65)
- `--bg-inset` oklch(0.235 0.009 65)
- `--ink` oklch(0.93 0.006 65)
- `--ink-secondary` oklch(0.70 0.010 65)
- `--ink-faint` oklch(0.55 0.010 65)
- `--line` oklch(0.32 0.010 65)
- `--accent` oklch(0.75 0.140 65)
- `--ok` oklch(0.70 0.135 150)
- `--warn` oklch(0.76 0.130 85)
- `--fail` oklch(0.68 0.165 25)

Bars (CPU cores, memory) use the ink ramp at rest and shift toward `--warn`/`--fail`
only past meaningful thresholds (70% / 90%) — quiet by default, loud when it matters.

## Typography

- UI: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`
- Numerals/data: same family with `font-variant-numeric: tabular-nums`; monospace
  (`ui-monospace, 'SF Mono'`) reserved for pids and byte values in the process table.
- Scale (px): 11 caption / 13 body / 15 section / 22 key numerals / 34 the one big
  CPU number. Weight contrast ≥ 1.25 steps: 400 body, 500 labels, 600 headings/numerals.
- Labels above values, 11px, `--ink-secondary`, sentence case. No ALL-CAPS shouting;
  small-caps tracking only for table headers.

## Layout

- Left sidebar (fixed 176px): nav items (Dashboard · Logs · Monitors · Diagnostics ·
  Settings), agent status pill pinned at the bottom (PDD §12).
- Content: 24px outer gutter, sections separated by whitespace and 1px hairlines,
  NOT card boxes. Metrics row (CPU + memory) above the process table; table owns the
  remaining height and scrolls internally.
- Balanced density: 28px table rows, 8px core-bar pitch.

## Components

- **Status pill**: dot + word ("Running", "Restarting…", "Failed", "Stopped") in the
  sidebar footer; dot color + label text, never color alone.
- **Core bars**: thin horizontal bars, one per core, ink at rest, threshold-tinted.
- **Memory bar**: single horizontal bar with "approx. used" caption (PDD §20 honesty).
- **Process table**: columns Process / PID / CPU % / Memory; sortable CPU|Memory via
  header click; header shows sort direction; zebra via `--bg-inset` at 50% strength.
- **Error/empty states**: in-place text blocks with the structured error message and a
  retry affordance when `retryable` (PDD §31). Never a spinner older than 300ms alone.

## Motion

- 160ms ease-out-quart on state transitions (pill color, sort flips). Value updates
  don't animate (numbers just change — steadiness over spectacle). Bars transition
  width 240ms ease-out-quart.
- `prefers-reduced-motion: reduce` disables all transitions.
