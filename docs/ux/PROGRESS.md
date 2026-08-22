# UX migration progress

Tracks which audit findings have landed on `UX-Edits`. Update the checkbox and the
"Landed in" column when a batch is committed. Finding ids match `AUDIT.md`.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Batch 1 — Design tokens and type scale
- [x] J1 — thirteen font sizes collapsed to six
- [x] J5 — accent colour restricted to one meaning
- [x] C1 — rail labels raised to 11px minimum
- [x] D1 — sidebar header un-uppercased, 12px
- [x] B5 — active vs hover states visually distinct

## Batch 2 — Icon system
- [x] J2 — one icon family, inline SVG
- [x] B3 — ▤ no longer means four things
- [x] C2 — ⚓ ◆ ✳ replaced with literal icons
- [x] G2 — preview toolbar icons at real size with real hit targets

## Batch 3 — Command registry and palette
- [ ] A2 — ⌘K command palette exists
- [ ] D3 — Explorer toolbar actions registered as commands
- [ ] F4 — session creation reachable without the terminal panel open

## Batch 4 — Chrome restructure and de-duplication
- [ ] A1 — one canonical home per action
- [ ] A3 — rail reduced to four items
- [ ] A4 — title bar and status bar roles separated
- [ ] B1 — Open Folder separated from panel toggles
- [ ] B2 — project name clickable in the title bar
- [ ] B4 — title bar carries live state
- [ ] C3 — badges no longer use accent colour
- [ ] C5 — rail down to four destinations
- [ ] I1 — status bar grouped into three sections
- [ ] I2 — interactive vs static status items visually distinct
- [ ] I4 — duplicated status bar items removed
- [ ] I5 — separators between status bar groups
- [ ] I6 — app-level entries collapsed into one settings control

## Batch 5 — Sessions panel
- [ ] F1 — split button, one click starts a session
- [ ] F2 — creation menu no longer mixes tasks and settings
- [ ] F3 — "check project on open" moved to Settings
- [ ] F5 — session tabs named meaningfully
- [ ] F6 — tab dot encodes state, not kind
- [ ] F7 — panel renamed "Sessions" with a header

## Batch 6 — Agent status chip
- [ ] A6 — persistent agent state visible in chrome
- [ ] I3 — "Claude preview idle" replaced

## Batch 7 — Start panel and empty states
- [ ] A8 — at most one empty state at full weight
- [ ] E1 — editor empty state replaced with Start panel
- [ ] E2 — empty state hands over an action, not a description
- [ ] E3 — one no-folder state, not two
- [ ] E4 — "since you were last here" summary

## Batch 8 — Preview and ports
- [ ] G1 — element picker promoted to primary control
- [ ] G3 — address placeholder no longer truncates
- [ ] G4 — ports rendered in one place
- [ ] G5 — "not attached" language removed
- [ ] G6 — fullscreen exit always visible
- [ ] C4 — ports badge counts only usable ports
- [ ] H1 — chrome counts match panel counts
- [ ] H2 — ports ranked by relevance
- [ ] H3 — "open ↗" renamed to match what it does
- [ ] H4 — ports probed before shown as loadable

## Batch 9 — Settings, themes, overlays, vocabulary, a11y
- [ ] A5 — "thread"/"instance" retired, "session"/"subagent" only
- [ ] A7 — Settings surface exists, theme picker moved into it
- [ ] D2 — one gesture to hide the sidebar
- [ ] D4 — native confirm() replaced for delete
- [ ] J3 — one overlay/modal system
- [ ] J4 — follow-system theme + high contrast added
- [ ] J6 — splitter hit areas and hover state

---

**Not covered by these batches** (flagged in the audit as open decisions or lower priority,
revisit after batch 9): editor/sessions swap (open question 1), Guide content reduction,
Metsuke wordmark, second-user onboarding path.
