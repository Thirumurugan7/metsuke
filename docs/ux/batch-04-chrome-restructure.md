# Batch 4 — Chrome restructure and de-duplication

Closes: A1, A3, A4, B1, B2, B4, C3, C5, I1, I2, I4, I5, I6. Reference: `AUDIT.md` zones
A, B, C, I in full, plus the "new layout" and "status bar" sections.

**This is the highest-risk batch.** It substantially rewrites `App.tsx` and
`StatusBar.tsx`. If anyone else (e.g. the `features` branch) is actively editing either
file, coordinate before starting — this batch will conflict hard with parallel changes
there. Depends on batch 3 (command registry) existing — this batch is largely about
removing duplicate hardcoded triggers now that a registry-backed home exists for each.

## 1. Rail: six items down to four (closes A3, C5)

In `App.tsx`, the `VIEWS` array currently has 6 entries: explorer, git, search, ports,
threads, claude. Change to 4:

```
explorer, git, search, agents
```

- `ports` is removed from the rail entirely — it moves to live only inside the Preview
  panel (this is actually batch 8's territory for the *content*, but removing the rail
  *entry* happens here since it's a chrome/de-dup change; coordinate order with whoever
  does batch 8, or do batch 8 first if ports isn't ready — either order works as long as
  the rail entry doesn't point at a panel that no longer renders anything sensible).
- `threads` and `claude` merge into one `agents` rail item. For this batch, the simplest
  correct move is: `agents` renders `<ThreadsPanel />` with a secondary tab strip at the
  top for "Sessions" vs "Usage" (the latter being what `ClaudePanel.tsx` renders today).
  Don't merge the two components' internals — just host them as two tabs under one rail
  destination. A full merge/redesign of that content is out of scope here.
- Update the `sidebar` type/`SidebarView` union in `store.ts` accordingly (remove
  `'ports'` and `'claude'` as top-level values if they're only reachable via the rail;
  keep whatever internal state is needed for the new tab strip inside `agents`).

## 2. Title bar restructure (closes B1, B2, B4)

Current title bar in `App.tsx`: app name, folder name (inert), then a flat row of 4
buttons (Open Folder, Sidebar, Preview, Terminal) with identical styling.

Restructure to three zones:

**Left — project switcher.** Make the folder-name text itself the clickable control
(replacing the separate "📂 Open Folder" button). It should show the folder name and,
when `git.branch` exists, the branch name beside it (reuse the git icon/branch text
pattern already in `StatusBar.tsx`'s branch button — don't reinvent, just relocate/adapt
it). Clicking opens folder-switching (same `openFolder()` call as today).

**Centre — agent status.** Leave a placeholder here for now — an empty `<div
className="title-agent-slot" />` or similar. Batch 6 fills this in; don't build the
agent chip itself in this batch, just leave the layout slot so batch 6 doesn't have to
touch this file's structure again.

**Right — layout control.** Replace the three separate Sidebar/Preview/Terminal buttons
with one segmented control (three toggle buttons visually grouped as a single unit,
e.g. a `<div className="layout-control">` wrapping three `<button>`s with shared
borders) rather than three independent buttons. Same three `togglePanel()` calls
underneath, different visual grouping.

Remove the standalone "📂 Open Folder" title-bar button entirely — its job is now done
by the project switcher on the left (closes B2's "inert vs clickable, backwards" problem
by making the prominent copy the actual control).

## 3. Status bar restructure (closes A4, I1, I2, I4, I5, I6)

This is the biggest single change in this batch. Current `StatusBar.tsx` renders 11
items in a flat row with one spacer. Target: 3 groups with visible separators.

**Left group — project truth (information, mostly non-interactive):**
- folder name — **remove**, now redundant with the title bar (I4)
- branch name + ahead/behind counts — keep, stays a button to `setSidebar('git')`
- changed-file count — keep only if `> 0`, same as today
- unsaved count — keep only if `> 0`, same as today

**Centre group — agent status:** placeholder for batch 6, same as the title bar. Leave
an empty slot; don't duplicate work building it here.

**Right group — system:**
- terminal/session count — keep, but rename its label from "N terminals" to whatever
  batch 5 settles on ("N sessions" most likely) — if batch 5 hasn't landed yet, leave
  the current label and let batch 5 update it, don't guess ahead
- update-ready/downloading notice — keep as-is, this one is correctly built (only shows
  when there's real news, per the existing code comment — don't change this logic)
- **one** settings entry, replacing the separate Guide button, Alerts button, and (once
  batch 6 removes it) the preview-attachment readout — a single icon-only button opening
  Settings. Settings itself doesn't need to exist yet for this batch (batch 9 builds
  it) — for now this button can open the existing `NotificationSettings` dialog as a
  placeholder, since that's the closest existing thing to a settings surface; batch 9
  replaces its destination.

**Remove entirely from the status bar** (all now duplicated elsewhere, per I4):
- Open Folder button — gone, title bar owns this now
- Ports count button — ports lives in Preview only now (per section 1)
- "Check project" / "Test UI" buttons — these move to the Start panel (batch 7) and are
  already reachable via the command palette (batch 3); remove them from here
- "Claude preview idle" / preview-attachment readout — batch 6 replaces this with the
  agent chip; remove the old readout now even if the chip isn't built yet, rather than
  leaving a redundant "idle" message on screen through the gap between batches
- Cursor position (`Ln X, Col Y`) — **keep**, this one is fine and cheap; just move it
  into whichever group makes sense (left group, since it's file/editor state)

**Grouping mechanics:** add a thin vertical separator (`1px`, `var(--border)`, some
margin) between each of the three groups. Within a group, tighter gap; between groups,
looser gap — this is what makes the structure legible without reading every label (I5).

**Interactive vs static (I2):** every remaining `<button>` should have a visible
non-hover affordance distinguishing it from a plain `<span>` status readout — e.g. a
subtle border or background tint at rest, not only on hover. Add a small CSS rule for
this rather than restyling each item ad hoc.

## 4. De-duplication pass elsewhere (closes A1, C3)

Grep the codebase for other call sites of `openFolder`, `togglePanel('terminal')`,
`togglePanel('preview')`, `setSidebar('ports')`/`setSidebar('git')` outside the places
kept above (title bar, and the panels' own internal empty-state buttons, which are
allowed to keep an action button — Law 1 is about chrome-level navigation duplicating
itself, not about every empty state losing its call-to-action). Specifically check:
- `Welcome.tsx`'s Open Folder button — **keep**, this is a legitimate empty-state action
- `Explorer.tsx`'s empty-state Open Folder button — **keep**, same reasoning
- `TerminalPanel.tsx`'s empty-state Open Folder button — **keep**
- Anything in `EditorPane.tsx` — **keep**, empty-state actions are fine

The point of A1 is chrome navigation (title bar / status bar / rail all offering the
same thing three times), not empty-state CTAs, which the audit explicitly treats as
correct (Law 4). Don't strip empty-state buttons in this batch.

For **C3** (badges using accent): this was largely handled in batch 1's token work
(`--badge` token). In this batch, just confirm every badge in the newly-restructured
rail/title-bar/status-bar uses `var(--badge)` rather than reintroducing `var(--accent)`
on any new element you add.

## Do not touch

- `TerminalPanel.tsx`'s internal New-session menu — that's batch 5.
- Any agent-status logic/UI — that's batch 6, this batch only leaves empty slots for it.
- Ports panel content — that's batch 8; this batch only removes the rail *entry*.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: walk through opening/closing a folder, toggling each of the three
  layout panels via the new segmented control, checking git status shows correctly in
  the left status-bar group, and confirming nothing that was removed (Open Folder in
  status bar, ports rail item, etc.) left a dangling reference or broken keyboard
  shortcut.
- Specifically re-test `⌘B` / `⌘J` (sidebar/terminal toggles) still work through the new
  segmented control's underlying calls.
- `npm run test:ui` — expect large diffs across nearly every baseline; review each one.

## When done

Tick A1, A3, A4, B1, B2, B4, C3, C5, I1, I2, I4, I5, I6 in `PROGRESS.md`. Commit as:
`ux(batch-04): chrome restructure and de-duplication`
