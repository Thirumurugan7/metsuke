# Batch 2 — Icon system

Closes: J2, B3, C2, G2. Reference: `AUDIT.md` zone J (J2), B (B3), C (C2), G (G2).

Depends on batch 1 being merged first (uses `--text-*` and interaction tokens). Scope:
new `src/renderer/components/Icon.tsx`, plus every component that currently renders a
glyph as a bare character. This batch is mechanical once the icon set is chosen — the
main cost is finding every occurrence, not designing anything.

## 1. Pick and install the icon set

Use [Lucide](https://lucide.dev) icons (MIT licensed, tree-shakeable, matches the
1.5px-stroke line-icon look the audit calls for). Install:

```
npm install lucide-react
```

Confirm this doesn't collide with the project's licence-generation tooling
(`npm run licenses` / `tools/licenses.mjs`) — run `npm run licenses:check` after
installing and regenerate with `npm run licenses` if it reports stale.

## 2. Build a thin wrapper, don't call lucide-react directly everywhere

Create `src/renderer/components/Icon.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'

/**
 * One glyph, one meaning, one place this is declared. Every icon used anywhere in the
 * app is named here — if two features need "the same kind of thing," they import the
 * same name, so a collision like the old ▤ meaning four things becomes structurally
 * impossible.
 */
export const ICONS = {
  files: /* folder-tree */,
  search: /* search */,
  git: /* git-branch */,
  agents: /* sparkles */,
  ports: /* plug */,
  preview: /* monitor */,
  sessions: /* terminal-square */,
  openFolder: /* folder-open */,
  notifications: /* bell */,
  pointAtElement: /* crosshair */,
  settings: /* sliders-horizontal */,
  back: /* chevron-left */,
  forward: /* chevron-right */,
  reload: /* rotate-cw */,
  fullscreen: /* maximize */,
  exitFullscreen: /* minimize */,
  close: /* x */,
  add: /* plus */,
  chevronDown: /* chevron-down */,
  check: /* check */,
  branch: /* git-branch */, // same glyph as `git`, deliberately — same meaning
  external: /* external-link */,
  sidebar: /* panel-left */,
  terminalPanel: /* panel-bottom */,
  previewPanel: /* panel-right */
  // add more only when a real batch needs one — do not pre-populate speculative icons
} as const satisfies Record<string, LucideIcon>

export function Icon({
  name,
  size = 16,
  className
}: {
  name: keyof typeof ICONS
  size?: 16 | 20
  className?: string
}): JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" className={className} />
}
```

Fill in the actual `lucide-react` import names in place of the comments (import each
one used at the top of the file, e.g. `import { FolderTree, Search, GitBranch, ... }
from 'lucide-react'`). Use 16px in dense chrome (status bar, tabs, toolbars) and 20px
in the activity rail, per the audit's icon spec.

## 3. Replace every bare-glyph occurrence

Grep the whole of `src/renderer` for these characters and replace each with
`<Icon name="..." />` at the matching size, removing the old `aria-hidden="true"` span
wrapper since `Icon` already sets that:

| Glyph | Old meaning(s) | File(s) | New icon name |
|---|---|---|---|
| `▤` | Files (rail) / Sidebar (title bar) / Terminal (title bar) / terminal count (status bar) | `App.tsx`, `StatusBar.tsx` | `files` for the rail item; `sidebar` for the sidebar toggle; `terminalPanel` for the terminal toggle and terminal count — **three different names now, not one glyph** |
| `⑂` | Source control / branch | `App.tsx`, `StatusBar.tsx`, `GitPanel.tsx`, `ThreadsPanel.tsx` | `git` (rail item), `branch` (branch name displays) |
| `⌕` | Search (rail) / Test UI (status bar) | `App.tsx`, `StatusBar.tsx` | `search` for the rail item only — Test UI's icon is out of scope here, batch 5/7 relocates that action entirely |
| `⚓` | Ports | `App.tsx`, `StatusBar.tsx`, `PortsPanel.tsx`, `Preview.tsx` | `ports` |
| `◆` | Threads / instance rows | `App.tsx`, `ThreadsPanel.tsx`, `NewThread.tsx` | `agents` for the rail item; leave the per-row instance marker as-is for now (batch 5 reworks Threads content) |
| `✳` | Claude | `App.tsx` | `agents` (folds into the same rail item as Threads, per A3 — but don't remove the Claude rail item's *content* in this batch, only its icon; the merge itself is batch 4/9) |
| `📂` | Open folder | `App.tsx`, `StatusBar.tsx`, `Explorer.tsx`, `TerminalPanel.tsx` | `openFolder` |
| `🔔` | Notifications | `StatusBar.tsx` | `notifications` |
| `⌖` | Element picker | `Preview.tsx` | `pointAtElement` |
| `‹` `›` | Back/forward | `Preview.tsx` | `back`, `forward` |
| `↻` | Reload | `Preview.tsx`, thread restart button in `TerminalPanel.tsx` | `reload` |
| `⛶` / `⤡` | Fullscreen toggle | `Preview.tsx` | `fullscreen` / `exitFullscreen` |
| `×` | Close (tabs, sidebar header, sheets) | `App.tsx`, `EditorPane.tsx`, `TerminalPanel.tsx`, `ThreadsPanel.tsx`, `QuickOpen.tsx` (if present) | `close` |
| `＋` | Add / new | `TerminalPanel.tsx`, `ThreadsPanel.tsx`, `Explorer.tsx` | `add` |
| `▾` | Menu caret | `TerminalPanel.tsx` | `chevronDown` |
| `●`/`○`/`◐` | Status dots | `StatusBar.tsx`, `ThreadsPanel.tsx`, `TerminalPanel.tsx` | **leave these alone** — they're colour+shape state indicators, not navigational icons, and batch 6 (agent chip) redesigns this vocabulary specifically. Don't touch status dots in this batch. |
| `↑` `↓` | Update ready / downloading, ahead/behind counts | `StatusBar.tsx` | leave as-is for now unless trivial to swap for a lucide arrow-up/arrow-down; not a priority collision |

Where a tooltip/`title` attribute currently duplicates what the glyph meant, keep the
tooltip text as-is — only the visual glyph is changing in this batch, not the copy
(copy changes are batch 9 / vocabulary pass).

## 4. Icon sizing and hit targets (closes G2)

While touching `Preview.tsx`'s toolbar buttons (back/forward/reload/fullscreen), also
bump their hit target: change `button.icon-only` usage there (or add a modifier class)
so these four buttons are at least 28×28px, not the current 22px minimum. Don't change
`button.icon-only`'s global 22px minimum in `styles.css` — only these four preview
toolbar buttons need the larger target per G2; a global bump is out of scope here.

## 5. Do not touch

- Status/state dots (see table above).
- Any icon inside `theme/ThemePicker.tsx` — themes are visual identity, not navigation,
  and get their own pass in batch 9.
- The seven fandom theme names/blurbs in `themes.ts`.
- Copy/labels next to icons — only the glyph itself changes here.

## Verify

- `npm run typecheck && npm test`
- Grep again after finishing for the six glyph characters above (`▤ ⑂ ⌕ ⚓ ◆ ✳`) in
  `src/renderer` — should return zero matches outside status-dot code and any
  intentionally-untouched file noted above.
- Launch with `npm run dev`, confirm every icon renders (a missing lucide import name
  fails silently as a blank glyph, so check visually, don't just trust the type
  checker).
- `npm run test:ui`, review diffs — expect this batch to touch almost every baseline
  image, that's expected and fine.

## When done

Tick J2, B3, C2, G2 in `PROGRESS.md`. Commit as:
`ux(batch-02): icon system`
