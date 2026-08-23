# UX migration progress

Tracks which audit findings have landed on `UX-Edits`. Update the checkbox and the
"Landed in" column when a batch is committed. Finding ids match `AUDIT.md`.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Batch 1 — Design tokens and type scale
- [ ] J1 — thirteen font sizes collapsed to six
- [ ] J5 — accent colour restricted to one meaning
- [ ] C1 — rail labels raised to 11px minimum
- [ ] D1 — sidebar header un-uppercased, 12px
- [ ] B5 — active vs hover states visually distinct

## Batch 2 — Icon system
- [ ] J2 — one icon family, inline SVG
- [ ] B3 — ▤ no longer means four things
- [ ] C2 — ⚓ ◆ ✳ replaced with literal icons
- [ ] G2 — preview toolbar icons at real size with real hit targets

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

**Layout superseded by batch 12.** The data work below stands (the `git:dirtyStat`
channel, `recentFiles`, the summary derivation). The arrangement of it on screen does not
— see batch 12 before implementing or re-implementing anything in section 2 of `batch-07`.

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
- [ ] G7 — loading progress indicator while a page loads
- [ ] G8 — open the current URL externally from the address bar
- [ ] G9 — responsive width presets in the preview toolbar
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

## Batch 10 — Sidebar panel system: Explorer, Source Control, and Search

Redesign, not a defect sweep. K8-K14 are the design spec; K1-K7 are the original defect
list, now folded into the sections they belong to. **Must land before batch 11** — K8 is
the panel anatomy batch 11's panels implement.

- [ ] K8 — one four-zone panel anatomy (header, toolbar, content, footer) with defined
      sticky behaviour, binding on every sidebar panel
- [ ] K9 — one horizontal grid and type ladder; five new layout tokens added to batch 1
- [ ] K10 — normative row state matrix: rest, hover, focus, selected, selected+focused,
      disabled, loading, dirty
- [ ] K11 — Explorer: toolbar row removed, actions moved into the panel header, plus
      collapse-all
- [ ] K12 — Source Control: collapsible sections with counts, commit field that grows on
      focus, commit button and busy line pinned to a footer
- [ ] K13 — Search: replace shown inline, toolbar and summary made sticky, hit rows
      aligned to the shared gutter
- [ ] K14 — sidebar minimum raised 160px to 200px; defined degradation to 260px via one
      container query
- [ ] K1 — bare glyphs in Explorer/GitPanel migrated to the icon system (section 8)
- [ ] K2 — GitPanel's discard action no longer uses native confirm() (section 5.4)
- [ ] K3 — visible keyboard focus in the Explorer tree (section 3.2; already landed for
      `[role="treeitem"]`, remaining work is git and search rows)
- [ ] K4 — one shared git status-badge implementation (section 3.3)
- [ ] K5 — Search empty-state hint; the chevron it was to re-icon is removed instead
      (sections 6.2, 6.5)
- [ ] K6 — roving keyboard navigation for Search results and Git's file lists (3.4)
- [ ] K7 — branch selector labelled (5.3); empty-state voice aligned (section 9)

## Batch 11 — Agents panel, and a standalone Claude rail item
- [ ] L1 — Claude given its own rail item (supersedes C5/A3's four-item count, by
      deliberate decision)
- [ ] L2 — ThreadsPanel's land/subagent/report-toggle glyphs migrated to the icon system
- [ ] L3 — ClaudePanel's recount button migrated to the icon system
- [ ] L4 — "This project" usage tab explains why it's disabled
- [ ] L5 — model-change confirmation names which session received it

## Batch 12 — Start panel, rebuilt, and dismissal

Two halves. M1-M9 rebuild the screen batch 7 shipped: **this supersedes batch 7's Start
panel layout**, not its data work. M10-M15 came from a separate report at the same time
and are what produced the audit's Law 7. Depends on batch 10's `useListKeyNav` hook, row
grid and state matrix, and on batch 9's `Modal.tsx`.

- [x] M1 — one column, one left edge; nothing on the screen is centre aligned
- [x] M2 — content column expressed by a real element; both dividers deleted
- [x] M3 — section labels drop to `--text-small`/400/`--fg-dim`; row labels at body
      weight in `--fg`; project title the only `--text-display` text on the screen
- [x] M4 — recent-file second column is always a workspace-relative parent directory, and
      renders no element when empty
- [x] M5 — the 8px row inset removed; one shared left edge, hover wash bleeds outside the
      column instead
- [x] M6 — optical vertical centring via `margin: auto` plus asymmetric container padding;
      pins to the top and scrolls once content overflows
- [x] M7 — one row idiom for every actionable line, reusing batch 10's `--row` (22px), row
      grid and state matrix
- [x] M8 — the diff stat becomes a row that runs `git.showChanges`
- [x] M9 — the two prepared-task links dropped from the Start panel; the New-session menu
      is now their single home (**reverses batch 5 section 3 and batch 7 section 2, by
      explicit user decision** — fix the stale sentence in both files when this lands)
- [x] M10 — session tab close control actually reveals on hover and stays visible on the
      active tab; focus-scoped `⌘W`; "session" not "terminal" in the tooltip; `Modal.tsx`
      confirmation when the session has a live process
- [x] M11 — close control in the Preview's own toolbar, plus `⌘⇧V` on `view.togglePreview`
- [x] M12 — Law 7 added to `AUDIT.md`; every openable surface audited against it
- [~] M13 — Sessions panel's own hide control. **Flagged, not fixed here** — needs a
      decision on whether a bottom-docked panel adopts batch 10 section 1's panel anatomy.
      Give it its own batch
- [x] M14 — `closeTerminal` focuses the neighbouring tab, not the last tab in the strip
- [x] M15 — `.terminal-tab.active` uses `--selected-bg`, not `--hover-strong` (B5, third
      occurrence)

Also in this batch, as one-line carry-overs rather than findings: `.welcome-title`'s
hardcoded `30px` in `onboarding.css` moves to `var(--text-display)` (a batch 1 leak, that
sweep was scoped to `styles.css`), and the stale `.welcome-inner` reference in the
`.start-panel` comment goes with the block it describes.

**`npm run test:ui` gap found while verifying this batch:** 25 of 26 specs fail, but on
inspection none of the failures are caused by this batch. They are selectors and copy
left over from batches 4, 5 and 11: `smoke.spec.ts` looks for `.title-folder` (now
`.project-name`), the shared mask helper in `tests/ui/helpers/stable.ts` looks for
`[title="Show listening ports"]` (no longer present anywhere in the status bar),
`terminals.spec.ts` looks for a `"New terminal"` button and a lowercase `claude` tab name
(now `"New session"` and `"Claude"`, per F5/F7), and `threads.spec.ts` presses
`Meta+Shift+T` for `.threads-panel` (superseded by batch 11's standalone Claude rail
item). This is suite-wide rot accumulated across several batches, not a batch-12
regression, and fixing it is out of this batch's scope — it touches specs and a shared
helper well beyond the Start panel and dismissal. Needs its own pass.

**Follow-up left open:** something is writing absolute paths into `recentFiles`. Batch 12
normalises at the display site, which is correct either way, but the producer is worth
finding. Note it here when identified.

---

**Not covered by these batches** (flagged in the audit as open decisions or lower priority,
revisit after batch 9): editor/sessions swap (open question 1), Guide content reduction,
Metsuke wordmark, second-user onboarding path.
