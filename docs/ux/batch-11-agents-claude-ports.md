# Batch 11 — Agents panel, and a standalone Claude rail item

Closes: L1, L2, L3, L4, L5. Reference: `AUDIT.md` zone L (new).

Depends on batches 1-4 (tokens, icons, command registry, chrome restructure) and
supersedes one specific piece of batch 4's own decision — see section 1. Scope:
`src/renderer/App.tsx`, `src/renderer/components/AgentsPanel.tsx`,
`src/renderer/components/ThreadsPanel.tsx`, `src/renderer/components/ClaudePanel.tsx`,
`src/renderer/state/store.ts`, `src/renderer/state/commands.ts`,
`src/renderer/components/Icon.tsx`, `src/renderer/styles.css`.

**Batch 10 must land first, and this batch inherits its panel anatomy.** Every panel this
batch touches or builds — the Agents panel and the newly standalone Claude panel — must
implement the four-zone skeleton defined in batch 10 section 1 (panel header with an
actions slot, optional sticky toolbar zone, the single scrolling content zone, optional
sticky footer zone), using the same class names (`.panel`, `.panel-toolbar`,
`.panel-content`, `.panel-footer`), the same sticky rules, the same row grid and state
matrix from batch 10 sections 2 and 3, and the same tokens. Concretely: `ClaudePanel`'s
usage-scope tabs belong in the toolbar zone and its "Recount" button (section 2 below) in
the header's actions slot, not in a panel-local header row of its own; `ThreadsPanel`'s
session list is the content zone and its new-session control goes in the actions slot.
Do not draw a second header row inside a panel, and do not put a panel's own scroll
container anywhere but `.panel-content`. If either panel genuinely needs a zone batch 10
does not define, that is a change to batch 10 section 1, agreed there first, not a local
exception here.

**Ports is out of scope here.** Batch 8 already covers ports in full — one home (G4),
probing (H4), ranking (H2), counts (C4, H1), and the "Preview" vs external-open verb fix
(H3). Nothing in the actual `PortsPanel.tsx`/`Preview.tsx` code that this audit found
during batch 11's research is left over once batch 8 lands. This batch is Agents and
Claude only.

## 1. Give Claude its own rail item, undoing part of batch 4's Agents merge (closes L1)

**This decision supersedes batch 4's A3/C5 finding that the rail should hold exactly
four items (`explorer, git, search, agents`).** That was the right call when Threads and
Claude were two small, thin panels competing for a name. They no longer are: Claude's
panel (usage, model, skills, plugins — see `ClaudePanel.tsx`) is its own substantial
surface, and burying it as the second tab of an "Agents" destination (today's
`AgentsPanel.tsx`, which renders a `Sessions`/`Usage` tab strip over `ThreadsPanel`/
`ClaudePanel`) makes it one click harder to reach than everything else in the rail, for
no real gain — nobody is confused about what "Claude" versus "Agents" would mean once
both exist as named destinations.

Concretely:

- In `App.tsx`'s `VIEWS` array, add a fifth entry:
  ```ts
  { id: 'claude', icon: 'agents', label: 'Claude', short: 'Claude', shortcut: `${MOD}⇧C` }
  ```
  Pick a distinct icon name from `agents` once one exists — see L1's icon note below;
  don't ship two rail items with the same glyph.
- Remove `AgentsPanel.tsx`'s tab strip entirely. It existed only to host `ClaudePanel`
  as a second tab; once Claude has its own rail item, `AgentsPanel.tsx` becomes an
  unnecessary wrapper. Either delete `AgentsPanel.tsx` and have `App.tsx`'s `agents`
  branch render `<ThreadsPanel />` directly (matching how `git`/`search`/`explorer`
  already render their panel directly, with no wrapper), or, if `AgentsPanel.tsx` is a
  convenient place to add Agents-specific chrome later, keep the file but strip it down
  to a passthrough with no tab UI. Prefer deleting it — a wrapper with no logic left in
  it is a place for the next person to wonder what it's for.
- Add a `claude` branch in `App.tsx`'s sidebar body switch, rendering `<ClaudePanel />`.
- Update `state/store.ts`'s `SidebarView` union: add `'claude'` back, and remove the
  `agentsTab`/`setAgentsTab` state (and its persistence, if any) that only existed to
  drive the tab strip.
- Update the `⌘⇧` key map in `App.tsx`'s global keydown handler to include `c: 'claude'`
  alongside the existing `e`/`g`/`f`/`a` entries.
- Register `view.claude` (or similar) in `state/commands.ts` under the `View` section,
  mirroring how `git.showChanges` already wraps `setSidebar('git')` — `setSidebar
  ('claude')`, same pattern.
- Update `AUDIT.md`'s region scorecard and C5/A3 finding text isn't something this batch
  edits directly (that's tracked separately in the audit updates), but note in your
  commit that this batch intentionally reopens C5 to five items — don't treat the rail
  item count as a regression to silently fix later.

## 2. Icon gaps specific to these two panels (closes L2, L3)

Batch 2's glyph sweep didn't reach every icon inside `ThreadsPanel.tsx` and
`ClaudePanel.tsx` because its table only tracked cross-cutting glyphs, not every
panel-local one:

- `ThreadsPanel.tsx`'s land action (`⤓`, line ~156) and the subagent-indent arrow (`↳`,
  line ~129) are bare characters. Add `land` and reuse an existing chevron/arrow icon
  (check `ICONS` before adding a new one — a rotated `forward` may already read
  correctly for the subagent indent) to `Icon.tsx`, and use them here.
- `ThreadsPanel.tsx`'s report-toggle caret (`▾`/`▸`, line ~175) should use the same
  `chevronDown` / `forward` pair batch 10 section 8 settles on for `Explorer.tsx`'s tree
  caret and for Source Control's collapsible section headers — same shape, same meaning,
  reuse those `ICONS` entries rather than adding new ones. (Batch 10 no longer has a
  `SearchPanel.tsx` chevron to match: its section 6.2 removes that control entirely and
  shows the replace row inline, so do not look for one there.)
- `ClaudePanel.tsx`'s "Recount" button (`↻`, line ~122) is the same bare-refresh gap
  flagged in batch 10 for Explorer and GitPanel (K1) — apply the same fix here, reusing
  the existing `reload` entry in `ICONS` as batch 10 section 8 does, so all four panels
  end up using one glyph for "refresh this list." Per the inherited anatomy above, this
  button lives in the panel header's actions slot.
- While choosing the rail icon for the new `claude` item (section 1), reserve a name
  distinct from `agents` — a small Claude-mark-style glyph if one already exists in the
  codebase (check `ClaudeMark.tsx`, which renders the product's own mark elsewhere) is a
  reasonable source rather than picking an arbitrary Lucide icon that has no connection
  to what the panel is about.

## 3. Explain why "This project" usage is disabled, not just that it is (closes L4)

`ClaudePanel.tsx`'s usage-period tabs include a "This project" option
(`scope === 'workspace'`) that's disabled with `disabled={!workspace}` and no `title`
attribute (line ~134) — silent when no folder is open, unlike the `blockedBy`-string
convention batch 3's command registry established specifically so disabled controls
explain themselves instead of just going grey. Add a `title` — "Open a folder to see its
usage" is consistent with the existing "Open a folder to start a session" pattern
already used for session creation.

## 4. Confirm which session received a model change (closes L5)

`ClaudePanel.tsx`'s "Apply to the running session" button (`applyToSession`, line ~102)
finds a Claude terminal, sends `/model <name>` into it, and switches focus to that tab
(`setActiveTerminal`) — but if the user isn't watching the Sessions panel at that
moment, nothing in the Claude panel itself confirms the change was sent, or names which
session got it when more than one Claude session is running (the function's fallback
logic picks one; the user doesn't see which). Add a brief inline confirmation next to
the button after a successful send — e.g. "Sent to <tab name>." — reusing whatever
short-lived local-state pattern is simplest here (a `useState` cleared after a few
seconds is enough; this doesn't need the global `Toasts.tsx` system, since it's
contextual to this one panel and button, matching how batch 8 treats its own
fullscreen-exit hint as local rather than global).

## Do not touch

- `PortsPanel.tsx`, `Preview.tsx` — batch 8's territory, confirmed fully covered, see
  the note at the top of this file.
- `Explorer.tsx`, `GitPanel.tsx`, `SearchPanel.tsx` — batch 10's territory.
- `NewThread.tsx`, `LandThread.tsx` — the worktree/land flows themselves aren't touched
  here, only the report-toggle and land-button icons inside `ThreadsPanel.tsx` (section
  2). Don't restructure how a thread is landed.
- The vocabulary pass (`thread`/`instance` → `session`/`subagent`, A5, batch 9) — if
  batch 9 hasn't landed yet when this batch runs, leave the existing "◆ instance" /
  "New thread" copy as-is rather than doing a partial vocabulary pass here; that's one
  batch's job, not two half-jobs across two batches.
- `ClaudePanel.tsx`'s `MODELS` list and what aliases it offers — that's a correctness
  question about what the CLI actually accepts, not a UX-audit finding; flag it back if
  you notice it's stale, don't silently edit the list as part of this batch.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: confirm the rail now shows five items, Claude reachable independently
  of Agents; confirm `⌘⇧C` opens it; confirm `⌘K` finds it via the command palette.
- Confirm `AgentsPanel.tsx`'s old tab strip is gone and Agents opens straight to the
  thread list, with no dangling reference to `agentsTab` anywhere in `store.ts` or its
  persistence.
- Confirm every icon touched in section 2 renders (no blank glyphs from a missing
  import).
- With no folder open, confirm the "This project" usage tab explains itself on hover
  instead of just sitting greyed out.
- Start two Claude sessions, change the model from the Claude panel, and confirm the
  inline confirmation names which session received it.
- `npm run test:ui`, review diffs (expect the rail/sidebar baseline to change
  meaningfully here, that's expected).

## When done

Tick L1, L2, L3, L4, L5 in `PROGRESS.md`. Also add a note there that this batch reopens
C5/A3's "four rail items" count to five, by deliberate decision, not oversight. Commit
as: `ux(batch-11): agents panel and a standalone claude rail item`
