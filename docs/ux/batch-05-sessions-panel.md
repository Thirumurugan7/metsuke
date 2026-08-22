# Batch 5 — Sessions panel

Closes: F1, F2, F3, F5, F6, F7. Reference: `AUDIT.md` zone F in full, and the "starting
a session" section with the before/after menu spec.

Depends on batch 3 (command registry) and batch 4 (rail/chrome already restructured).
Scope: `src/renderer/components/TerminalPanel.tsx`, `src/renderer/state/store.ts`. This
is the flow the audit was originally asked to fix — the "New" button behind which the
launcher, the canned tasks, and a settings checkbox were all mixed together.

## 1. Rename the panel (closes F7)

`TerminalPanel.tsx` renders no heading at all today — just a tab strip and the New
menu. Add a proper header above the tab strip: label it **"Sessions"**. This is a
one-line addition but it's the single most-cited finding (F7) — don't skip it because
it looks trivial.

Also rename the component's exported name and its usage in `App.tsx` if it's clean to
do so (`TerminalPanel` → `SessionsPanel`), but only if this doesn't ripple into a large
unrelated rename elsewhere (e.g. IPC channel names in `shared/ipc.ts` — leave those
alone regardless of what the component/file is called; a display rename is not the same
as an internal rename, and the latter is out of scope here).

## 2. Split-button launcher (closes F1)

Replace the current `＋ New ▾` single button with a split button:
- **Primary segment** (larger click area, left side): starts a Claude session
  immediately — calls whatever `addTerminal('claude')` does today. This is the 80% case
  and should cost exactly one click, per the audit.
- **Caret segment** (narrow, right side, `Icon name="chevronDown"`): opens a menu with
  *creation options only*:
  - Claude session (same as clicking the primary segment — include it in the menu too
    for discoverability, with its shortcut shown)
  - Claude session on a new branch (worktree) — if this capability doesn't exist as a
    single action yet, check whether `NewThread.tsx`'s worktree checkbox logic can be
    reused/exposed here rather than duplicating that logic; if it can't cleanly, wire it
    through `NewThread.tsx`'s existing sheet instead of building a second path — don't
    create two different worktree-creation code paths
  - Shell

Give the primary segment the shortcut `⌘⇧N` / `Ctrl+Shift+N`. Register both the split
button's primary action and each menu item as commands in `state/commands.ts` (from
batch 3) under the `Agent` section, if they aren't already registered there — this
keeps the palette and this button reading from the same source rather than diverging.

When `!workspace`, don't just disable the button — per F4 (closed in batch 3) the
button's tooltip/label should say why: "Open a folder to start a session."

## 3. Remove tasks and the settings checkbox from this menu (closes F2, F3)

The current menu contains, below a separator: "Run project check," "Test UI end to
end," and a "Check project on open" checkbox. Per F2, a creation menu should contain
only ways to create a session — remove all three from this menu.

- "Run project check" and "Test UI end to end" — these become **task cards** the Start
  panel offers (batch 7 builds the Start panel itself; for this batch, just make sure
  removing them from here doesn't remove the underlying `runProjectCheck`/`runUiAudit`
  store functions, since batch 3 already registered commands wrapping them and batch 7
  will surface them as cards). If batch 7 hasn't landed yet, these two actions are still
  reachable via `⌘K` in the meantime — that's an acceptable gap between batches, not a
  regression, since the palette already covers them.
- "Check project on open" checkbox — remove from this menu. This is a persistent
  per-project preference and belongs in Settings (batch 9). If Settings doesn't exist
  yet when this batch runs, leave the underlying `autoCheck`/`setAutoCheck` store state
  intact but stash the checkbox somewhere temporary and clearly marked — e.g. render it
  once inside the Welcome screen's system-check area with a comment noting it's a
  stopgap until batch 9 — rather than deleting the only way to control this setting.
  Note this stopgap location in `PROGRESS.md` so batch 9 knows to find and remove it.

## 4. Name session tabs meaningfully (closes F5)

Currently every Claude tab is titled "claude" (see `tab.title` usage in
`TerminalPanel.tsx` / how tabs get created in `store.ts`'s `addTerminal`). Change tab
naming:
- If a session was started with an opening prompt (the `prompt` field already exists on
  `TerminalTab` per the current code), derive a short title from it — first several
  words, truncated, similar to how thread titles are already handled in
  `NewThread.tsx`/`ThreadsPanel.tsx` (reuse that truncation approach if one already
  exists rather than writing a new one).
- If no prompt, allow the user to rename the tab (double-click to edit, matching
  whatever inline-rename pattern the codebase already uses elsewhere — check
  `Explorer.tsx`'s rename-on-double-click for files, and mirror that interaction rather
  than inventing a new one).
- Fall back to a numbered name ("Claude 2", "Claude 3") only when there's genuinely
  nothing to derive from and the user hasn't renamed it.

## 5. Tab dot encodes state, not kind (closes F6)

Currently `.terminal-dot` gets class `dead` / `tab.kind` (i.e. it shows whether the tab
is a dead process, or otherwise shows `claude` vs `shell` — kind, not state). Change so:
- **Kind** (Claude vs shell) is shown via a small icon next to the tab name instead
  (reuse the `agents`/`sessions` icon distinction from batch 2's `Icon` component) —
  this duplicates less, since the tab name/prompt context usually already implies kind.
- **The dot** shows *state*: running normally, waiting on input, exited. Check what
  state signal is already available — `ThreadsPanel.tsx`'s `ThreadStatus` type
  (`running`/`waiting`/`idle`/`done`/`failed`) is exactly this vocabulary; see whether
  terminal tabs can read the same underlying hook-driven signal (the `Notification`/
  `Stop` hooks mentioned in `README.md`) rather than inventing a second state model for
  terminals separate from threads. If the current architecture doesn't expose that
  signal to a plain terminal tab (as opposed to a `Thread`), that's a legitimate finding
  to flag back rather than force — note in `PROGRESS.md` if F6 can only be partially
  closed without a store/main-process change, and what would be needed.

## Do not touch

- `NewThread.tsx` and `ThreadsPanel.tsx` internals beyond what's needed to reuse
  truncation/worktree logic — those get a lighter pass, if any, as part of batch 4's
  rail merge, not here.
- Any IPC channel definitions — if new signal plumbing is genuinely required for F6,
  flag it rather than adding it silently; new `shared/ipc.ts` channels need a handler on
  both sides per the project's own house rule, and that's a bigger change worth calling
  out explicitly before doing it.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: confirm one click on the split button's primary segment starts a
  Claude session; confirm the caret menu contains only the three creation options;
  confirm the removed items (tasks, checkbox) are gone from this menu specifically;
  confirm tab names differ across multiple sessions with different prompts; confirm
  rename-on-double-click works.
- `npm run test:ui`

## When done

Tick F1, F2, F3, F5, F6, F7 in `PROGRESS.md` (mark F6 partial if the state signal
genuinely isn't reachable without further plumbing, and describe what's missing).
Commit as: `ux(batch-05): sessions panel`
