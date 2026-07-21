# Product

## Register

product

## Users

A software developer on macOS running local services (APIs, dev servers, workers) during
development. Comfortable with terminals but tired of juggling `top`, scattered `tail -f`
panes, and ad-hoc `curl` loops. Glances at DeskPulse on a second display or from the menu
bar mid-task; the primary job is "is my machine and my local stack healthy right now?"
answered in under two seconds. Secondary audience: technical reviewers and hiring managers
reading the repository who may never run the app but judge the engineering through it.

## Product Purpose

DeskPulse is a macOS menu-bar diagnostics app: live CPU/memory/process metrics,
rotation-safe log tailing, HTTP health checks with native notifications, and one-click
diagnostic export. The Dashboard is the at-a-glance surface (PDD UC1): current load,
memory pressure, top processes, and whether the supervised background agent is alive.
Success is glanceability, honesty about failure states (agent down is a first-class
visible state, never a blank screen), and native macOS citizenship.

## Brand Personality

Calm, precise, trustworthy. A quiet instrument, not a product pitch: the data is the
interface. Feels like a first-party macOS utility with the typographic care of a modern
developer tool (Activity Monitor's honesty, Linear's precision). Never loud, never
gamified, never decorative.

## Anti-references

- SaaS analytics dashboards: gradient hero metrics, KPI card grids, celebratory charts.
- "Web app in an Electron wrapper" chrome: web-style buttons, marketing typography,
  spinners everywhere.
- Grafana/observability maximalism: wall-to-wall panels, neon-on-black, dense chrome.
- Electron-default blue everything.

## Design Principles

1. **Data is the interface.** Numerals, bars, and states carry the screen; chrome stays
   near-invisible. Typography does the hierarchy work.
2. **Honest states.** Loading, degraded, agent-down, and not-ready are designed states
   with words, never blank panels or infinite spinners. Color is never the only signal
   (icon + text always accompany it).
3. **Native citizenship.** System font, system appearance (light and dark), standard
   window chrome, macOS spacing rhythms. It should feel installed, not visited.
4. **Steady under motion.** Values refresh every 2 s; layout never shifts, numbers never
   jitter (tabular numerals, fixed-width slots). Motion only communicates change, and
   respects reduced-motion.
5. **Restraint as craft.** One warm accent used sparingly; health semantics
   (ok/warn/fail) are the only other colors that may speak.

## Accessibility & Inclusion

Keyboard-navigable primary flows with visible focus rings; respects
`prefers-reduced-motion`; color never the sole health indicator (icons + text labels
accompany every state); contrast target WCAG AA in both light and dark appearances
(PDD §11).
