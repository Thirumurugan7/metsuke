# Batch 3 — Command registry and palette

Closes: A2, D3, F4. Reference: `AUDIT.md` zone A (A2), D (D3), F (F4), and the palette
mock-up in the audit's "command surface" section.

Depends on batches 1-2 (uses the new tokens and `Icon` component). This is the
foundation batch — build it before 4, 5, 6, or those batches wire their own actions and
recreate the duplication problem this whole project exists to fix.

## 1. The command registry

Create `src/renderer/state/commands.ts`. This is a plain module-level registry, not a
React context — anything can register a command, anything can read the list.

```ts
import type { useStore } from './store'

type State = ReturnType<typeof useStore.getState>

export interface Command {
  id: string
  title: string
  section: 'Agent' | 'Go to' | 'Preview' | 'Source control' | 'View' | 'Settings'
  keywords: string[]
  icon: string // a key of ICONS from components/Icon.tsx
  shortcut?: string
  /** Whether this command should currently appear/be enabled at all. */
  when: (s: State) => boolean
  /** Shown in place of the command when `when` returns false and the command should
   *  still be visible but explain why it can't run, rather than just vanishing. */
  blockedBy?: (s: State) => string | null
  run: (s: State) => void | Promise<void>
}

const registry = new Map<string, Command>()

export function registerCommand(command: Command): void {
  if (registry.has(command.id)) {
    // Fail loudly in dev rather than silently letting a second registration win —
    // a duplicate id is exactly the bug this registry exists to prevent.
    console.error(`Command "${command.id}" is already registered.`)
    return
  }
  registry.set(command.id, command)
}

export function allCommands(): Command[] {
  return Array.from(registry.values())
}

export function commandsFor(state: State): Array<Command & { blocked: string | null }> {
  return allCommands()
    .filter((c) => c.when(state) || c.blockedBy)
    .map((c) => ({ ...c, blocked: c.when(state) ? null : (c.blockedBy?.(state) ?? null) }))
    .filter((c) => c.blocked !== null || true) // keep all; palette decides how to render blocked ones
}
```

Adjust the exact shape as needed once you see how `useStore` is typed, but keep the
core contract: **one registration per action, an id, a title, a section, keywords, an
icon name, an optional shortcut, a `when` predicate, and a `run` function.** Everything
downstream (palette, and later batches' rail/menu/status-bar rendering) reads from this
list rather than hardcoding its own copy of the action.

## 2. Register the commands this batch is responsible for

Do not try to register every command in the whole app in this batch — only the ones
tied to A2/D3/F4. Later batches (4, 5, 6, 8, 9) each add their own registrations as they
touch those areas. For this batch, register:

**Go to** section:
- `goto.file` — reuses the existing file-fuzzy-search logic already in `QuickOpen.tsx` /
  `state/fuzzy.ts`. Don't duplicate that logic; the palette's file mode should call the
  same `rank()` function `QuickOpen.tsx` already uses.
- `goto.line` — jump to line (if `store.ts` already exposes `revealLine`, wire to it)
- `goto.symbol` — only if a symbol source already exists somewhere (check Monaco's
  built-in outline/symbol provider before building anything new); if nothing exists,
  skip this one rather than inventing a symbol index from scratch — note it as a gap in
  `PROGRESS.md` instead.

**Agent** section (register the ones that already exist as actions today; F1/F2/F5
session-creation restructuring itself is batch 5, but the *commands* for what already
exists should exist now):
- `session.new.claude` — calls whatever `store.ts` function starts a Claude session
  today (`addTerminal('claude')` per the current code)
- `session.new.shell` — same, `addTerminal('shell')`
- `agent.checkProject` — wraps the existing `runProjectCheck` store action
- `agent.testUi` — wraps the existing `runUiAudit` store action

**Preview** section:
- `preview.pointAtElement` — wraps `startInspect`/`stopInspect`
- `preview.reload` — needs a way to reach the webview ref; if that's only accessible
  inside `Preview.tsx` today, either lift a minimal reload-trigger into the store (a
  simple `previewReloadRequest` counter/event the component listens for) or skip
  registering this one now and note the gap — don't do a large refactor of `Preview.tsx`
  in this batch, that's batch 8's job.

**Source control** section:
- `git.showChanges` — `setSidebar('git')`

**View** section:
- `view.toggleSidebar`, `view.toggleTerminal`, `view.togglePreview` — wrap the existing
  `togglePanel()` store calls (these currently exist as title-bar/status-bar buttons;
  registering them as commands doesn't remove those buttons yet, that's batch 4)
- `view.quickOpen` — open the palette pre-filtered to files (see section 4 below)

**Explorer** section (closes D3 specifically — these currently only exist as unlabelled
context-menu/toolbar actions in `Explorer.tsx`):
- `explorer.newFile`, `explorer.newFolder` — wrap the existing `create()` logic already
  in `Explorer.tsx`; these need a target directory, so when run from the palette
  (rather than the toolbar) default to the workspace root
- `explorer.openFolder` — wraps `openFolder()`

For each, write the `when` predicate honestly — e.g. `session.new.claude` should be
`(s) => s.workspace !== null` with `blockedBy: () => 'Open a folder to start a session'`,
which is what actually closes F4 (today the equivalent button is just disabled with a
tooltip; a `blockedBy` string is stronger because the palette can show it as text next
to the greyed-out row, not just as a hover tooltip nobody triggers by typing).

## 3. Build the palette component

Create `src/renderer/components/CommandPalette.tsx`, modelled closely on the existing
`QuickOpen.tsx` (same overlay/focus-trap/keyboard-nav pattern — reuse
`useFocusTrap` from `a11y/useFocusTrap.ts`, don't reinvent it).

Modes, switched by the first character typed:
- plain text → file search (reuse `rank()` from `state/fuzzy.ts`)
- `>` prefix → commands from the registry, fuzzy-matched against `title` + `keywords`
- `@` prefix → sessions/threads (list from `store.ts`'s `threads`/`terminals` state)
- no prefix, but the text doesn't look like a filename (no `.` or `/` and doesn't match
  any file) → **pin a synthetic top row**: `✳ Ask Claude "<what you typed>"`. Selecting
  it should either focus the most relevant existing Claude session and send the prompt,
  or start a new one if none exists — wire this via whatever `store.ts` function sends
  text to a terminal (`call('terminal:write', ...)` per the existing `TerminalPanel.tsx`
  pattern) or via `addTerminal('claude', { prompt: ... })` if none is running yet. Get
  the exact wiring right by reading how `NewThread.tsx` passes an opening prompt today.

Grouped results render under section headers matching the `Command['section']` union.
A blocked command (has a `blockedBy` string) still renders, greyed out, with the
`blockedBy` text shown inline instead of the shortcut.

## 4. Wire it into `App.tsx`

- `⌘K` / `Ctrl+K` opens `CommandPalette` in default (mixed) mode.
- `⌘P` / `Ctrl+P` — keep the existing behaviour (opens the same surface, but pre-filtered
  to file mode) so current muscle memory isn't broken; don't remove `QuickOpen.tsx`'s
  existing keyboard binding, retarget it to open `CommandPalette` in file-only mode
  instead. Decide during implementation whether to delete `QuickOpen.tsx` and fold its
  logic into `CommandPalette.tsx`, or keep `QuickOpen.tsx` as a thin file-only wrapper
  around the same underlying list component — either is fine, but don't end up with two
  separate independent implementations of file search.
- Add `<CommandPalette />` next to the other overlay components already rendered at the
  bottom of `App.tsx` (`<QuickOpen />`, `<NewThread />`, etc.)

## 5. Do not touch

- Don't remove any existing button/menu that currently triggers these actions — this
  batch adds a new way to reach them, it doesn't remove the old ways yet (that's
  batch 4's de-duplication pass, which needs this registry to exist first).
- Don't restructure the New-session menu (batch 5) or the status bar (batch 4) in this
  batch, even though it's tempting once commands exist — stay scoped.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: open `⌘K`, confirm file search, `>` command mode, and the pinned "Ask
  Claude" row all work; confirm `⌘P` still opens file search directly as before.
- Test at least one blocked command with no folder open (e.g. `session.new.claude`)
  and confirm the `blockedBy` text renders instead of a silently-disabled row.
- `npm run test:ui`

## When done

Tick A2, D3, F4 in `PROGRESS.md`. Commit as:
`ux(batch-03): command registry and palette`
