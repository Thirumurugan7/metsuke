# Batch 7 — Start panel and empty states

> **⚠ Section 2's layout is superseded by `batch-12-start-panel-and-dismissal.md`. Do not
> implement it.**
>
> This batch shipped, and the screen it produced was wrong: two competing alignment axes,
> dividers that were the only thing expressing the content column, section labels louder
> than their own content, four visual idioms on seven actionable lines, and a third of the
> pane empty. Batch 12 (zone M) rebuilds the layout from scratch.
>
> **What still stands, unchanged, and is reused by batch 12:** the `git:dirtyStat` IPC
> channel and its handler (section 3), the `recentFiles` list and its localStorage
> mechanism (section 2), the "since you were last here" derivation including the
> `showSummary` guard, and section 1's one-empty-state split between `Welcome.tsx` and
> `EditorPane.tsx` (E3).
>
> **What is withdrawn:** section 2's arrangement of those sections on screen, the
> `.start-*` CSS block it produced, the centred `button.primary` primary action, and
> section 2's "Or start something" block. Per M9, the two prepared-task actions are
> dropped from this screen entirely and the New-session menu from batch 5 is their single
> home, which reverses this batch's own decision to make the Start panel their primary one.

Closes: A8, E1, E2, E3, E4. Reference: `AUDIT.md` zone E in full, A (A8), and the "empty
to start" section with the Start panel mock-up.

Depends on batches 3-6. May need a new main-process IPC channel (see section 3) — per
`CLAUDE.md`, main-process changes need a full editor restart to take effect, and
`src/shared/ipc.ts` is the contract both sides import, with a test asserting every
declared channel has a handler. Add the channel there first if you need one.

## 1. One empty state, not two (closes E3)

Today there are two different "no folder open" experiences: `Welcome.tsx` (fuller,
better, includes the system check for `claude`/`git`) and `EditorPane.tsx`'s own inline
empty state ("Welcome to Metsuke" / "Open a folder to browse its files..."). Remove
`EditorPane.tsx`'s duplicate — when `!workspace`, render `<Welcome />` there and nowhere
else. Check `App.tsx` isn't already rendering `<Welcome />` in a way that would now
double up (currently `App.tsx` renders `{!workspace && <Welcome />}` inside
`.editor-region` alongside `<EditorPane />`, and `EditorPane.tsx` *also* has its own
`!workspace` branch — pick one location, most likely keep `App.tsx`'s and delete the
duplicate branch inside `EditorPane.tsx`).

## 2. Build the Start panel for the "folder open, nothing selected" case (closes E1, E2)

This is the more important of the two empty states — the current one ("No file open" /
"Pick a file from the Explorer, or search for one by name") is the *default* state of
the largest pane in the app, since an agent workflow rarely has a file open unless the
user is actively editing.

Create `src/renderer/components/StartPanel.tsx`, rendered by `EditorPane.tsx` (or by
`App.tsx`'s `.editor-region`, whichever is the cleaner integration point given how
`showEditor`/`diffPath` logic currently gates what's visible there) when
`workspace && activePath === null && !diffPath`.

Sections, top to bottom:

**Header** — project name + branch (can reuse the same project-switcher content style
from batch 4's title bar, doesn't need to duplicate the click behaviour, just the
visual).

**"Since you were last here"** — a summary line built from data already computed
elsewhere:
- git diff stat (`+142 −38 across 2 files`) — this data already exists via `git` in
  `store.ts` (same source `StatusBar.tsx` uses for its change count) — compute added/
  removed line totals from the existing `GitStatus` shape if it's not already
  aggregated, rather than adding a new IPC call
- most recent subagent/session report completion, if any exist — reuse
  `ThreadsPanel.tsx`'s `age()` helper and `thread.report`/`thread.endedAt` fields
- Only render this section if there's actually something to show — an empty "nothing
  happened" line is worse than no section at all (per Law 4, don't manufacture content).

**"Pick up where you left off"** — a short list (3-5) of recently opened files as
clickable rows, each calling `openFile(path)`. Check whether `store.ts` already tracks
recently-opened files (it may track `openFiles`/`dirty` but not a *historical* recent
list) — if no recency tracking exists, add a small bounded list (e.g. last 10 paths,
capped) persisted the same way other lightweight UI state is persisted in this app
(check how `sidebarWidth`/theme choice are persisted and follow that same mechanism,
likely `localStorage` or an IPC-backed settings store — don't invent a third persistence
mechanism).

**"Or start something"** — three actions, reusing whatever batch 5 built:
- the session split-button's primary action (start a Claude session)
- "Check this project" — wraps `runProjectCheck` (this is where the task moved to, per
  batch 5's note that these needed a new home)
- "Test the UI" — wraps `runUiAudit`

Only show these three action buttons in the empty/Start panel, not both here and still
in the New-session menu (batch 5 already removed the menu items) or the status bar
(batch 4 already removed those) — this is meant to be the one place they now live,
alongside the command palette.

## 3. "Since you were last here" data — check before adding IPC

Most of section 2's data (git diff stat, session reports) is likely already available
client-side via existing store state. If reading actual line-level diff stats requires
a call the app doesn't currently make (e.g. a full `git diff --stat` rather than just
file-level status), check `src/main/services/` for an existing git service method
before adding a new IPC channel. Only add a new channel in `shared/ipc.ts` (with a
handler on both main and renderer sides, per the project's own contract test) if
nothing existing covers it, and keep the addition small and specifically scoped to
what the Start panel needs.

## 4. Preview and Sessions empty states — apply the same principle, but scope is limited here

Per the audit, Preview's empty state gets a smarter version (detecting a likely dev
port or a `package.json` dev script) — **that's batch 8's job**, not this batch's. Don't
build it here even though it's tempting while touching empty states broadly. Similarly,
Sessions' empty state (batch 5 already gives it one primary CTA) doesn't need rework
here.

This batch's scope is specifically: the editor pane's two empty states (folder-closed
and file-not-open), per E1/E2/E3/E4/A8.

## 5. The "at most one empty state at full weight" rule (closes A8)

This is mostly a consequence of doing 1-2 correctly, plus not regressing anything: once
the Start panel exists, a fresh launch with a restored folder should show the Start
panel at full weight in the editor region. If Preview and ports still show their own
(currently un-smartened, that's fine until batch 8) empty states simultaneously, that's
acceptable for now — full closure of A8 depends on batch 8 also landing. Note in
`PROGRESS.md` that A8 is partially closed by this batch and fully closed once batch 8
ships its smarter Preview empty state.

## Do not touch

- `Preview.tsx`'s empty state — batch 8.
- `TerminalPanel.tsx`/Sessions empty state — already handled in batch 5.
- Any new main-process service beyond what section 3 explicitly allows, and only after
  confirming nothing existing already covers it.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: open a folder with uncommitted changes and at least one prior session
  report, confirm the Start panel shows a real "since you were last here" summary, not
  a placeholder; confirm recent files are clickable and open correctly; confirm the
  three action buttons work and match what batch 5 built.
- Test with a completely fresh folder (no git history, no sessions) — confirm the
  "since you were last here" section simply doesn't render rather than showing an
  awkward empty version of itself.
- If a new IPC channel was added: confirm the contract test (that every declared
  channel has a handler) passes, and restart the full app (not just hot-reload) to
  verify the main-process change actually took effect, per `CLAUDE.md`'s own warning
  about this exact trap.
- `npm run test:ui`

## When done

Tick A8 (partial, note dependency on batch 8), E1, E2, E3, E4 in `PROGRESS.md`. Commit
as: `ux(batch-07): start panel and empty states`
