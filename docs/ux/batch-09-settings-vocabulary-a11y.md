# Batch 9 — Settings, themes, overlays, vocabulary, a11y

Closes: A5, A7, D2, D4, J3, J4, J6. Reference: `AUDIT.md` zones A (A5, A7), D (D2, D4),
J (J3, J4, J6). This is the closing batch — polish and consistency passes that are
easiest to do once everything else has settled, since several of them (vocabulary
especially) touch nearly every file.

## 1. Build the Settings surface (closes A7)

Create `src/renderer/components/Settings.tsx` as a dialog (reuse whatever the "one
overlay system" from section 4 below settles on — build this after deciding that, or
build it first using the existing `.sheet`/`.sheet-scrim` pattern and let section 4's
consolidation absorb it, either order is fine as long as they end up consistent).

Four sections in one dialog, likely as tabs or a left-hand sub-nav within the dialog:

- **Appearance** — move `ThemePicker` here from `NotificationSettings.tsx` (see
  `App.tsx`'s existing `<NotificationSettings />` render — that component currently
  hosts the theme picker at line ~111 per the codebase; extract it out entirely,
  `NotificationSettings` should only contain notification settings after this).
- **Notifications** — the content already in `NotificationSettings.tsx`, minus the
  theme picker. Consider renaming the component to `Settings.tsx` with an internal
  section rather than keeping `NotificationSettings.tsx` as a separate top-level dialog
  — check how it's triggered today (`setSettingsOpen` in `store.ts` per `StatusBar.tsx`)
  and decide whether to repoint that same store flag at the new unified dialog or keep
  a second flag; one dialog with internal sections is the target, however you get there
  structurally.
- **Project** — per-project preferences. This is where batch 5's "Check project on
  open" checkbox belongs; if batch 5 left it in a stopgap location (check
  `PROGRESS.md`'s note about this), move it here now and delete the stopgap.
- **Privacy** — the usage-reporting toggle already described in `README.md` (check
  `TelemetryConsent.tsx` for where this currently lives — likely just needs a settings
  entry point added, reusing existing store state rather than a new mechanism).

Add `⌘,` / `Ctrl+,` to open Settings globally (wire in `App.tsx`'s existing keydown
handler, following the same pattern as the other global shortcuts already there). Also
register `settings.open` as a command in `state/commands.ts` under the `Settings`
section (batch 3's registry already reserved this section name).

Update the status bar's settings button (added in batch 4 as a placeholder pointing at
`NotificationSettings`) to open the new unified `Settings` dialog instead.

## 2. Theme catalogue additions (closes J4)

In `theme/themes.ts`:
- Add a **follow-system** option. This likely isn't a `Spec`/`Theme` entry itself but a
  meta-choice that resolves to `dark` or `light` based on `prefers-color-scheme` at
  runtime — check `theme/useTheme.ts`/`theme/apply.ts` for where theme selection is
  currently read/applied and add the system-preference listener there. Make this the
  default for new installs (check wherever `DEFAULT_THEME` is currently consumed, e.g.
  first-run state, and point it at follow-system instead of the hardcoded `'dark'`).
- Add a **high contrast** theme (at least one; dark is the priority, light is a bonus if
  time allows). Use the existing `contrast()` function already exported from
  `themes.ts` to verify body-text contrast hits at least the WCAG AA ratio (4.5:1) once
  you've picked values — the function already exists specifically to make this
  checkable, use it rather than eyeballing.
- Group the picker (`ThemePicker.tsx`, now living inside Settings > Appearance per
  section 1): "Standard" group first (Follow system, Dark, Light, High contrast),
  "More themes" group below (the five existing fandom themes, using the `group: 'core'
  | 'fandom'` field that already exists on each `Spec` — the grouping data is already
  there, this is primarily a `ThemePicker.tsx` rendering change, not a data-model
  change).

## 3. Vocabulary pass (closes A5)

Grep the entire `src/renderer` tree (and any user-facing strings in `src/main` that
reach the UI, e.g. notification text) for: `thread`, `Thread`, `instance`, `Instance`.
Per the audit, only two nouns survive in user-facing copy: **session** (a running
Claude) and **subagent** (runs inside one).

This is a copy/label change, not a data-model rename — do **not** rename the underlying
`Thread`/`ThreadStatus`/`ThreadMode` TypeScript types in `shared/ipc.ts` or the IPC
channel names as part of this batch; that's a much larger, riskier change than a UX
batch should take on, and the internal type name doesn't need to match the user-facing
word. Scope this to:

- `ThreadsPanel.tsx` — "◆ instance" → "session", any other visible "thread"/"instance"
  text in labels, tooltips, `aria-label`s
- `NewThread.tsx` — "Separate instance" → whatever the mode's user-facing name should
  be ("New session," matching batch 5's language); "Subagent" stays "Subagent," that
  noun survives
- Any rail/panel heading still saying "Threads" (should already be "Agents" after batch
  4's rail merge — confirm, don't reintroduce it)
- `App.tsx`'s `VIEWS` array's `label`/`short` fields if any still reference "Threads"
- Component/prop names can stay as they are internally (e.g. `ThreadsPanel.tsx` as a
  filename) — this pass is about what the user reads, not what the code is called.

Also check "Land" (`LandThread.tsx`, `openLandThread`, thread-row's "Land" button) per
the audit's H3-adjacent naming note — rename the user-facing button/dialog title from
"Land" to something naming the actual git operation, e.g. "Merge into main" (using the
actual target branch name, not literally "main"). Leave the component/function names
as-is internally, same reasoning as above.

## 4. One overlay/modal system (closes J3)

Currently two idioms exist: `QuickOpen.tsx`'s `.overlay`/`.quick-open` (used by the
command palette too, after batch 3) and `NewThread.tsx`/`LandThread.tsx`'s
`.sheet-scrim`/`.sheet`. Consolidate to one system with two sizes:

- A **command surface** variant: anchored near the top of the viewport, used by the
  palette (batch 3) — keep this geometry, it's correct for a fast-typing search-like
  UI.
- A **dialog** variant: centered, used by Settings (section 1), New session (batch 5's
  worktree option if it opens a dialog), Land/Merge, and any confirmation dialogs
  (including D4's delete-confirmation, see section 5).

Practically: pick whichever existing CSS (`.overlay`+`.quick-open` or
`.sheet-scrim`+`.sheet`) is better-built and extend it into a shared base (e.g. a
`Modal.tsx` wrapper component handling the scrim, focus trap via the existing
`useFocusTrap` hook, Escape-to-close, and a `variant: 'command' | 'dialog'` prop for the
positioning/sizing difference), then migrate both existing idioms onto it. This is a
mechanical consolidation, not a visual redesign — same dismissal behavior
(click-outside, Escape) everywhere afterward.

## 5. Replace native confirm() for delete (closes D4)

In `Explorer.tsx`, the `remove()` function currently calls the browser's native
`confirm()`. Replace with an in-app confirmation using the `Modal.tsx` dialog variant
from section 4 (or the existing `.sheet` pattern if section 4 hasn't been done yet —
either order works, just don't end up with a third distinct modal idiom). The
confirmation should:
- name the specific file/folder being deleted, visually emphasized
- have a clearly destructive-styled confirm button (check `button.danger` already
  exists in `styles.css` per the audit's CSS notes — use it)
- default focus on Cancel, not Delete, so a stray Enter keypress doesn't confirm a
  deletion

## 6. Sidebar hide gesture (closes D2)

Currently both the `×` in the sidebar panel header (`App.tsx`, inside `.sidebar-header`)
and re-clicking the already-active rail icon hide the sidebar — two gestures, no visual
relationship. Per D2, keep the rail click as the single documented gesture and either
remove the `×` entirely, or (better, if removing it regresses discoverability) make it
visually match the rail's hide affordance, e.g. reuse the same icon
(`Icon name="sidebar"`, from batch 2) rather than a bare `×`, so a user who learns one
gesture visually recognizes the other as the same action rather than a different one.

## 7. Splitter affordance (closes J6)

In `styles.css`, `.splitter` is currently a bare 1px line with hit-area extended via a
pseudo-element, no visible hover/drag state. Add:
- a visible hover state (e.g. the splitter widens or changes color/opacity on `:hover`)
- a visible active/dragging state, distinct from hover
- widen the actual hit-area pseudo-element to at least 8px on each side of the visual
  1px line, if it isn't already that wide (check the existing `::before`/`::after`
  extension in `styles.css` and adjust the offset/width values)

## Do not touch

- Any IPC channel or main-process renames — this batch is renderer-facing copy and
  presentation only, aside from the (already-scoped) confirmation dialog which doesn't
  need new IPC, it reuses the existing `files:delete` call, just with a different
  confirmation UI in front of it.
- The seven theme specs' actual palette values, beyond adding the new high-contrast
  entry.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: open Settings via `⌘,` and via the status bar button, confirm all four
  sections render and the theme picker works from its new location; cycle to
  follow-system and high-contrast themes; confirm delete now shows the in-app
  confirmation, not a native browser dialog; confirm the sidebar hides the same way
  whichever gesture is used; drag a splitter and confirm a visible hover/active state.
- Grep once more for `thread`/`instance` in user-facing strings (JSX text content,
  `title`/`aria-label`/`placeholder` attributes) to confirm the vocabulary pass didn't
  miss a file.
- `npm run test:ui`

## When done

Tick A5, A7, D2, D4, J3, J4, J6 in `PROGRESS.md`. This should be the last batch — once
it's committed, review `PROGRESS.md` end to end and confirm every finding id from
`AUDIT.md` is either ticked or explicitly noted as an open/deferred item (per
`AUDIT.md`'s "not covered by these batches" note). Commit as:
`ux(batch-09): settings, themes, overlays, vocabulary, a11y`
