# Batch 10 — Sidebar panel system: Explorer, Source Control, and Search

Closes: K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14. Reference:
`AUDIT.md` zone K, and zone D (D1's un-uppercased header, which this batch carries one
level down into the panels themselves).

Depends on batches 1 through 4 (tokens, icons, command registry, chrome restructure) and
on batch 9's `Modal.tsx` for the confirmation in section 5.4. Scope:
`src/renderer/App.tsx` (the `.sidebar-header` slot only, see section 1),
`src/renderer/components/Explorer.tsx`, `src/renderer/components/GitPanel.tsx`,
`src/renderer/components/SearchPanel.tsx`, `src/renderer/components/Icon.tsx`,
`src/renderer/state/store.ts` (the sidebar width clamp only),
`src/renderer/state/gitStatus.ts` (new), `src/renderer/state/useListKeyNav.ts` (new),
`src/renderer/styles.css`.

**This batch is a redesign, not a defect sweep.** The three sidebar panels were built one
at a time and never against a shared plan, so each one invented its own header, its own
left edge, its own scroll behaviour and its own idea of what a row is. Sections 1 through
3 define the system all three then obey; sections 4 through 7 apply it panel by panel;
sections 8 and 9 finish the icon and copy work that was the whole of this batch's earlier
draft.

**Batch 10 runs before batch 11 because of section 1.** The panel anatomy defined there
is binding on every sidebar panel in the app, including the Agents and Claude panels that
batch 11 rebuilds. If batch 11 lands first, those two panels get built against no
contract and this batch turns into a second retrofit of the same kind it exists to
remove.

---

## 1. The shared panel anatomy (closes K8)

Every sidebar panel is the same four zones, top to bottom, always in this order. A panel
may omit an optional zone. No panel may add a fifth.

```
┌────────────────────────────────────────────────┐
│ PANEL HEADER                        30px       │  fixed, outside the scroll container
│ ┌────────────┬───────────────┬───┬───┐         │
│ │ Explorer   │ (spacer)      │ ░ │ ▤ │         │  title · actions slot · hide sidebar
│ └────────────┴───────────────┴───┴───┘         │
├────────────────────────────────────────────────┤
│ TOOLBAR / FILTER ZONE               26px       │  optional · sticky top: 0
│ ┌────────────────────────────────────────────┐ │
│ │ branch, query box, filter chips            │ │
│ └────────────────────────────────────────────┘ │
├────────────────────────────────────────────────┤
│ CONTENT ZONE                        1fr        │  the ONLY zone that scrolls
│                                                │
│   row                                          │
│   row                                          │
│   row                             ▲            │
│   row                             │ scrolls    │
│   row                             ▼            │
│                                                │
├────────────────────────────────────────────────┤
│ FOOTER / STATUS ZONE                22px       │  optional · sticky bottom: 0
│ "128 results in 14 files"                      │
└────────────────────────────────────────────────┘
```

### 1.1 What each zone is for

**Panel header (required, `--panel-header`, 30px).** Owned by `App.tsx`, not by the
panel. Holds three things in this order: the panel title (`var(--text-panel)`, sentence
case, `var(--fg)`, already correct after batch 1's D1 fix), an **actions slot** the panel
fills, and the hide-sidebar button. The actions slot is new. Today `.sidebar-header`
(`styles.css` around line 436) is a bare `justify-content: space-between` row containing
only the title and the hide button, so a panel that needs a button has nowhere to put it
and grows a second row of its own instead. That is exactly what Explorer does.

In `App.tsx` (around line 254) the header becomes:

```tsx
<div className="sidebar-header">
  <span className="panel-title">{activeView?.label}</span>
  <div className="panel-actions" ref={panelActionsRef} />
  <span className="header-sep" aria-hidden="true" />
  <button className="icon-only" title="Hide sidebar" ...><Icon name="sidebar" /></button>
</div>
```

The panel fills `.panel-actions` through a portal, or, if a portal reads as too much
machinery for this, `App.tsx` renders a per-view `<PanelActions view={sidebar} />` and
each panel exports its action buttons as a small component. Either is acceptable. What is
not acceptable is a panel drawing its own header row.

The `.header-sep` hairline (1px, `var(--border)`, 12px tall, 6px margin either side)
separates panel actions from the hide-sidebar button. This keeps batch 9's D2 decision
intact: the hide gesture is still one gesture drawn one way, and it now reads as
chrome-level rather than as one more panel action.

**Toolbar / filter zone (optional, `--row-header`, 26px).** The panel's own persistent
controls: the branch switcher, the search query box, a filter row. 26px is the natural
height of an `input` at the base rule in `styles.css` around line 141 (13px text, 3px
padding, 1px border), so a toolbar containing an input and one containing only buttons
line up without a second measurement.

**Content zone (required, `1fr`).** Rows, sections, the tree. The only scrolling zone in
the panel.

**Footer / status zone (optional, 22px, `--row`).** One line of ambient truth about what
the content zone is showing: a result count, a running-operation notice. Never an action.
If a panel wants a persistent action it belongs in the header's actions slot.

### 1.2 Sticky behaviour, stated once

| Zone | Scrolls? | Mechanism |
|---|---|---|
| Panel header | No, it is outside the scroll container | `.sidebar` flex child, `flex: 0 0 var(--panel-header)` |
| Toolbar | No | `position: sticky; top: 0; z-index: 2; background: var(--bg-alt)` |
| Section headers inside content | Yes, but each pins under the toolbar as it reaches it | `position: sticky; top: 0; z-index: 1` inside the scroll container |
| Rows | Yes | none |
| Footer | No | `position: sticky; bottom: 0; z-index: 2; background: var(--bg-alt)` |

**The structural change this requires.** Today `.sidebar-body` (`styles.css` around line
495) is `flex: 1; min-height: 0; overflow: auto`, so it is the scroll container and
everything a panel renders scrolls, including Explorer's toolbar, Source Control's branch
bar and commit box, and Search's query input. Type a query, scroll the results, and the
box you typed into is gone.

Change `.sidebar-body` to `overflow: hidden` and give every panel root a grid:

```css
.sidebar-body { flex: 1; min-height: 0; overflow: hidden; }

.panel {
  display: grid;
  grid-template-rows: auto 1fr auto;   /* toolbar · content · footer */
  height: 100%;
  min-height: 0;
}
.panel-toolbar {
  align-items: center;
  background: var(--bg-alt);
  display: flex;
  gap: 4px;
  height: var(--row-header);
  padding: 0 var(--panel-gutter);
  position: sticky;
  top: 0;
  z-index: 2;
}
.panel-content { min-height: 0; overflow: auto; padding-bottom: 12px; }
.panel-footer {
  background: var(--bg-alt);
  border-top: 1px solid var(--border);
  color: var(--fg-dim);
  font-size: var(--text-small);
  height: var(--row);
  line-height: var(--row);
  padding: 0 var(--panel-gutter);
  position: sticky;
  bottom: 0;
  z-index: 2;
}
```

`.explorer`, `.git-panel` and `.search-panel` all become `.panel` plus their own
modifier. A panel with no toolbar and no footer still uses the grid and simply renders no
element in those rows; `auto` collapses them to zero.

### 1.3 This contract binds batch 11

`AgentsPanel`, `ThreadsPanel` and `ClaudePanel`, as batch 11 rebuilds them, must
implement the same four zones with the same class names, the same sticky rules and the
same tokens. Concretely, batch 11's Claude panel puts its usage-scope tabs in the toolbar
zone and its "Recount" button in the header's actions slot, and its Agents panel puts the
session list in the content zone with the new-session control in the actions slot. If a
batch 11 panel needs a zone this section does not define, that is a change to this
section, agreed here first, not a local exception.

---

## 2. Density and rhythm (closes K9)

### 2.1 What is actually wrong

The row height is already consistent and should stay: `.tree-row` (line 536),
`.git-row` (line 1893), `.search-hit` (line 2000) and `.log-row` (line 1948) all use
`height: var(--row)`, which is 22px (`:root`, line 41). That part of the system was right.

The horizontal edges are not. Measured today:

| Element | Left edge | Text column starts at |
|---|---|---|
| `.tree-row` at depth 0 | 8px (inline `depth * 12 + 8`, `Explorer.tsx` lines 373 and 465) | about 38px, after a 10px caret and an emoji icon |
| `.git-row` | 8px (`padding: 0 8px`) | 8px, there is no icon column at all |
| `.search-hit` | 8px, inherited from `.search-panel`'s `padding: 6px 8px` (line 1972) | 48px, after a 32px right-aligned line number and an 8px gap |
| `.log-row` | 8px | 8px |
| `.section-header` | 8px | 8px |
| `.tree-empty` / `.section-empty` | 12px (line 609) | 12px |

So switching from Explorer to Source Control to Search moves the text you are reading
from about 38px, to 8px, to 48px, in a 280px-wide column. Nothing is aligned to anything
and the empty-state copy is indented 4px further than the rows it replaces.

Two further rhythm defects in the same area:

- **The indent step lives in JSX.** `Explorer.tsx` hardcodes `depth * 12 + 8` in an inline
  style, twice (lines 373 and 465). A layout constant that cannot be seen from
  `styles.css` will drift the first time anyone touches either line.
- **`.section-header` is the D1 defect, one level down.** Line 1878: `font-size:
  var(--text-small)` (12px), `text-transform: uppercase`, `letter-spacing: 0.06em`,
  `color: var(--fg-dim)`. That is precisely the treatment batch 1 removed from
  `.sidebar-header` for destroying word shape, still in place on every section heading in
  Source Control.

### 2.2 The rhythm, defined

One vertical step and one horizontal grid for every panel:

```
  ├─ 8px ─┼─ 16px ──┼─ 6px ─┼──────────── text column ────────────┼─ 6px ─┼─ 8px ─┤
  │       │ leading │       │                                     │       │       │
  │gutter │  icon   │  gap  │  name, path, matched line           │  gap  │ badge │
  │       │  slot   │       │                                     │       │ gutter│
```

- **Row height:** `var(--row)`, 22px. Unchanged, all four row types already agree.
- **Horizontal gutter:** `var(--panel-gutter)`, 8px, on both edges of every row, every
  section header, every empty state and every toolbar. This is the one number that makes
  the left edge stop moving between panels. `.tree-empty` and `.section-empty` drop from
  12px to 8px.
- **Leading icon slot:** `var(--icon-col)`, 16px, fixed width, present on every list row
  in every panel whether or not that panel has an icon to draw. Source Control's rows and
  Search's hits get the slot too, so the filename in Source Control starts at the same x
  as the filename in Explorer.
- **Indent step:** `var(--indent-step)`, 12px per tree depth, applied to the icon slot's
  left margin rather than to the row's padding, so the row background still bleeds to the
  panel edge at every depth (it does today, and that is correct, do not regress it).
- **Search's line-number column** keeps its 32px right-aligned monospace width but moves
  inside the icon slot's position: the line number *is* Search's leading column. 32px is
  wider than `--icon-col`, so `.search-hit` sets `--icon-col: 32px` locally rather than
  adding a second constant.
- **Trailing badge gutter:** 6px gap, then the row's trailing element (git badge, hit
  count) ending flush at the 8px gutter.

### 2.3 Tokens

Reuse the batch 1 names wherever one exists. Do not introduce a parallel scale.

Already available and to be used as-is: `--row` (22px), `--text-micro`, `--text-small`,
`--text-body`, `--text-panel`, `--hover`, `--hover-strong`, `--selected-bg`, `--focus`,
`--badge`, `--modified`, `--untracked`, `--removed`, `--conflict`, `--fg`, `--fg-dim`,
`--border`, `--bg-alt`.

Five values in this batch have no token and are currently hardcoded, sometimes in more
than one file. **Add these to batch 1's `:root` block in `styles.css` (around line 41,
beside `--row`), not to a panel-local rule, and update batch 1's spec to list them:**

```css
--panel-header: 30px;   /* sidebar header height; today a literal in .sidebar-header */
--row-header: 26px;     /* toolbar zone height; the natural height of a base input   */
--panel-gutter: 8px;    /* the single horizontal padding for every panel row         */
--icon-col: 16px;       /* fixed leading icon column, so text columns align          */
--indent-step: 12px;    /* tree depth step; today an inline style in Explorer.tsx    */
```

`.sidebar-header`'s `flex: 0 0 30px` becomes `flex: 0 0 var(--panel-header)`.

### 2.4 Type inside a panel

Three sizes, no more:

| Role | Token | Applies to |
|---|---|---|
| Panel title | `--text-panel`, 15px, `var(--fg)`, sentence case | `.sidebar-header` only |
| Section heading | `--text-body`, 13px, `var(--fg)`, sentence case, `font-weight: 600` | `.section-header`, `.search-file-name` |
| Row text | `--text-body`, 13px | `.tree-name`, `.git-path`, `.log-subject` |
| Row metadata | `--text-small`, 12px, `var(--fg-dim)` | `.git-dir`, `.log-hash`, `.log-author`, `.search-line`, footer copy |

`.section-header` (line 1878) loses `text-transform: uppercase` and `letter-spacing`,
moves from `var(--text-small)` to `var(--text-body)`, and from `var(--fg-dim)` to
`var(--fg)` with `font-weight: 600`. Its padding becomes `0 var(--panel-gutter)` with
`height: var(--row-header)`.

`.count` (line 1888) currently uses `background: var(--hover-strong)`, which is the hover
wash doing duty as a badge ground. Change to `background: var(--badge)`, the token batch 1
added for exactly this, so a count chip does not read as a permanently hovered thing.

Search's matched text stays monospace (`.search-text`, line 2018). That is correct and
deliberate: it is source, not prose. Everything else in these panels stays in the UI face.

---

## 3. Row states, focus and keyboard (closes K10, and absorbs K3, K4, K6)

### 3.1 The matrix

One list row, every state it can be in, and what renders. This table is normative for
`.tree-row`, `.git-row`, `.search-hit`, `.log-row`, and for every row batch 11 adds.

| State | Background | Text | Leading icon | Trailing | Outline |
|---|---|---|---|---|---|
| Rest | none | `var(--fg)` | `var(--fg-dim)` | badge if any; row actions hidden | none |
| Hover | `var(--hover)` | `var(--fg)` | `var(--fg)` | row actions become visible | none |
| Keyboard focused | `var(--hover)` | `var(--fg)` | `var(--fg)` | row actions become visible, same as hover | `2px solid var(--focus)`, `outline-offset: -2px` |
| Selected / active | `var(--selected-bg)` | `var(--fg)` | `var(--fg)` | badge | none |
| Selected and focused | `var(--selected-bg)` | `var(--fg)` | `var(--fg)` | badge | `2px solid var(--focus)`, `outline-offset: -2px` |
| Disabled | none | `var(--fg-dim)` | `var(--fg-dim)` | none; `aria-disabled="true"` | none |
| Loading | none | `var(--fg-dim)` | a static skeleton bar at `var(--hover)`, no spinner per row | none | none |
| Dirty / modified | per rest or selected above | `var(--fg)` | unchanged | the shared git badge, section 3.3 | per row |

Three rules the table encodes and that are worth stating in words, because the current
CSS breaks all three:

1. **Selected is a different property from hover, not more of it.** `.tree-row.active`
   (line 548) is `var(--hover-strong)`, a 10 percent wash, against `.tree-row:hover`'s
   5 percent. That is the B5 defect that batch 1 fixed on the activity rail and never
   carried into the tree. `.tree-row.active` becomes `var(--selected-bg)`.
2. **Focus is additive.** A focused row shows the focus outline *on top of* whatever
   background its rest/hover/selected state already had. It never replaces it, so
   "which row is selected" and "where is my cursor" remain two separate readings.
3. **Keyboard focus reveals the same affordances hover does.** Today `.git-row .git-actions
   button` is `opacity: 0` and only `.git-row:hover` raises it (lines 1922 to 1927). Those
   stage, unstage and discard buttons therefore do not exist for a keyboard user or on a
   touch input at all. Add `.git-row:focus-within .git-actions button { opacity: 1 }`
   alongside the hover rule, and reveal them on the roving-focused row too.

### 3.2 What is already there, and what is missing (closes K3)

`styles.css` around line 99 already carries a global rule:

```css
button:focus-visible,
[role='treeitem']:focus-visible,
.splitter:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
```

So Explorer's tree rows, which carry `role="treeitem"` (`Explorer.tsx` line 374), do get a
visible focus ring. **K3 is closed for the tree and should not be re-done.** What is
missing is everything else:

- `.git-row` (`GitPanel.tsx` line 276) is a bare `<div>` with an `onClick`, no `role`, no
  `tabIndex`, no key handling. It cannot receive focus at all, so there is no focus state
  to style.
- `.search-hit` (`SearchPanel.tsx` line 151) is the same: `<div>` plus `onClick`.
- `.log-row` (line 201) is not interactive and should stay that way, but must then not
  render a `cursor: pointer` (it does not today, which is correct, leave it).
- `input:focus` / `select:focus` / `textarea:focus` (line 151) use `outline: 1px solid
  var(--accent)`. Move them to `2px solid var(--focus)` so the focus ring is one thing in
  one colour at one weight throughout the sidebar, per J5.

Generalise the global rule to cover the new roles rather than adding per-panel rules:

```css
button:focus-visible,
[role='treeitem']:focus-visible,
[role='option']:focus-visible,
.splitter:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
```

### 3.3 One git status badge, drawn once (closes K4)

The same seven states are rendered by two implementations that do not agree.
`Explorer.tsx`'s `statusBadge()` (lines 11 to 35) collapses `modified`, `renamed` and
`copied` all to the letter `M` and returns four classes (`badge-modified`, `badge-added`,
`badge-deleted`, `badge-conflict`). `GitPanel.tsx`'s `LETTERS` and `STATE_LABELS` (lines
15 to 34) keep `R` and `C` distinct and use a different class family
(`.git-letter`, `.letter-*`, lines 1928 to 1947). The colours happen to match today; the
letters do not.

Extract `src/renderer/state/gitStatus.ts`:

```ts
export function statusBadge(state: GitFileState): { letter: string; className: string; label: string } | null
```

- Keep **GitPanel's letters** (`M A D R C U !`), not Explorer's collapse to `M`. Explorer
  showing `R` for a renamed file is strictly more information at no cost, and the tooltip
  already explains it. This reverses the earlier draft of this batch, which chose
  Explorer's set; with the panels now sharing a row grammar there is no reason to show
  the user less in one panel than the other.
- Keep **one class family**: `.badge-*`, since it is the shorter name and already carries
  the four colour rules. Delete `.git-letter` and `.letter-*` (lines 1928 to 1947) and
  give `.tree-badge`'s rule a second selector for the Source Control row.
- The badge occupies the trailing 14px of the row grid in both panels, `font-weight: 700`,
  `var(--text-small)`, `text-align: center`.
- Explorer keeps deriving *which* state to show from the file's unstaged status falling
  back to staged (`Explorer.tsx` line 18); that logic is Explorer's, not the badge's, and
  stays where it is.

### 3.4 Roving keyboard navigation, one hook for three lists (closes K6)

`Explorer.tsx`'s `onTreeKeyDown` (lines 141 to 194) is the only real keyboard
implementation in the sidebar and it is good: it reads rows from the DOM in render order
rather than from a flattened model, which is what makes collapsed directories fall out
for free. Factor its core into `src/renderer/state/useListKeyNav.ts`:

```ts
useListKeyNav({ rowSelector: '[role="option"]', onFocusChange: (id) => void })
```

handling `ArrowUp`, `ArrowDown`, `Home`, `End`, and `Enter`/`Space` to activate. Apply it
to:

- `SearchPanel.tsx`'s hit list: the results container becomes `role="listbox"`, each
  `.search-hit` becomes `role="option"` with a roving `tabIndex`, and `Enter` opens the
  file at that line, matching the click at line 155.
- `GitPanel.tsx`'s staged and changes sections: same treatment on `.git-row`, `Enter`
  opens the diff, matching the click at line 276. Both sections participate in one roving
  sequence, so Down at the end of Staged lands on the first row of Changes rather than
  dead-ending.

Leave `ArrowLeft` / `ArrowRight` out of the shared hook. Expanding and collapsing a
directory is tree behaviour, it belongs in `Explorer.tsx`, and Explorer keeps its own
handler wrapping the shared one.

---

## 4. Explorer (closes K11)

### 4.1 Before and after

```
BEFORE                                    AFTER
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Explorer                  ▤  │          │ Explorer     ＋ ⊞ ↻ ⇱ │ ▤    │  actions in the
├──────────────────────────────┤          ├──────────────────────────────┤  header, one row
│              ＋  🗀  ↻       │ ← second │ ▾ 📁 src                     │  saved, nothing
│                              │   row,   │   ▾ 📁 renderer              │  scrolls away
│ ▾ 📁 src                     │   right- │     ▸ 📁 components      M   │
│   ▾ 📁 renderer              │   aligned│       App.tsx                │
│     ▸ 📁 components      M   │   scrolls│   ▸ 📁 main                  │
│       App.tsx                │   away   │ ▸ 📁 docs                    │
│   ▸ 📁 main                  │          │   README.md              U   │
│ ▸ 📁 docs                    │          │                              │
│   README.md              U   │          │                              │
└──────────────────────────────┘          └──────────────────────────────┘
```

### 4.2 The toolbar row is deleted

`.explorer-toolbar` (`styles.css` line 614, `Explorer.tsx` lines 198 to 223) is a
`justify-content: flex-end` row of three icon buttons with `padding: 2px 6px 4px`, sitting
inside `.sidebar-body` and therefore scrolling away with the tree. It costs about 28px of
a 280px-wide panel's height, it is right-aligned for no reason while everything below it
is left-aligned, and its buttons vanish the moment you scroll to the file you wanted to
act on.

Delete it. The three buttons move into the panel header's actions slot from section 1.1,
and a fourth joins them:

| Order | Action | Icon | Notes |
|---|---|---|---|
| 1 | New file | `add` | already an `Icon`, `Explorer.tsx` line 205 |
| 2 | New folder | `folderAdd` | currently the bare character `🗀`, line 213 |
| 3 | Refresh | `reload` | currently the bare character `↻`, line 222; reuse the existing `reload` entry, do not add a `refresh` near-duplicate |
| 4 | Collapse all | `collapseAll` | new. Calls `toggleDir` closed on every path in `expanded`, or clears the set outright. A deep tree with no way back to the top is the most-cited missing Explorer control and it costs one store call |

All four are 24 by 24 hit targets in the header, gap 2px. All four already exist, or in
the case of collapse-all should be added, as registry commands from batch 3 so the palette
and the header read from the same source and their labels cannot drift.

### 4.3 Zones

- **Header actions:** the four above.
- **Toolbar zone:** none. Explorer has no persistent filter today and this batch does not
  add one.
- **Content:** the tree, now the full height of the panel.
- **Footer:** none.

### 4.4 The row

`.tree-row` keeps its 22px height and gains the section 2.2 grid:

```
│8px│ caret 10px │ icon 16px │ 6px │ name ............... │ 6px │ badge 14px │8px│
      └─ indented by depth * var(--indent-step) ─┘
```

- Move the inline `paddingLeft: depth * 12 + 8` (lines 373 and 465) off the row and onto
  the caret's left margin, as `marginLeft: depth * var(--indent-step)` read from CSS via a
  custom property (`style={{ '--depth': depth }}` and `margin-left: calc(var(--depth) *
  var(--indent-step))`). The row itself then always starts at `var(--panel-gutter)` and
  its hover and selection backgrounds bleed to the panel edge at every depth, as they do
  today.
- The caret (`.tree-caret`, line 551) keeps its 10px width and becomes an `Icon` per
  section 8, not `▾` / `▸`.
- The file and folder emoji become icons per section 8. This is the single biggest visual
  change in the panel: a 12px full-colour emoji font next to 16px 1.5px-stroke line icons
  is why the tree currently does not look like the rest of the app.
- The badge is the shared one from section 3.3.

### 4.5 Empty state

`.tree-empty` renders the bare string "This folder is empty" (`Explorer.tsx` line 250) at
12px left padding, offering nothing. Per Law 4 it becomes a short factual line at
`var(--panel-gutter)` plus the action that is now three zones away in the header:

```
This folder is empty.
[ New file ]  [ New folder ]
```

Two ghost buttons, `var(--text-small)`, running the same registry commands as the header
actions. The no-folder state (`.panel-empty`, lines 86 to 96) is already correct: title,
hint, one primary action. Do not change it.

---

## 5. Source Control (closes K12, and absorbs K2 and K7's labelling half)

### 5.1 Before and after

```
BEFORE                                    AFTER
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Source Control            ▤  │          │ Source Control    ↻  ⋯ │ ▤   │
├──────────────────────────────┤          ├──────────────────────────────┤
│ [ main         ▾ ] ↓Pull ↑Push│ ← all   │ ⑂ main            ↓2   ↑1    │ ← toolbar,
│                              │   of     ├──────────────────────────────┤   sticky
│ ┌──────────────────────────┐ │   this   │ Message (⌘Enter to commit)   │ ← 1 line at
│ │ Commit message (⌘Enter…) │ │   scrolls├──────────────────────────────┤   rest, grows
│ │                          │ │   away   │ ▾ Staged            2        │   on focus
│ │                          │ │          │   ⊙ App.tsx          M       │
│ └──────────────────────────┘ │          │   ⊙ store.ts         M       │
│ [ Commit 2 staged files    ] │          │ ▾ Changes           3        │
│                              │          │   ⊙ Icon.tsx         M       │
│ STAGED CHANGES            2  │ ← 12px   │   ⊙ notes.md         U       │
│ App.tsx                  M   │   upper- │   ⊙ old.ts           D       │
│ store.ts                 M   │   case,  │ ▸ History           30       │ ← collapsed
│ CHANGES                   3  │   dim,   │                              │   by default
│ Icon.tsx                 M   │   letter-│                              │
│ notes.md                 U   │   spaced ├──────────────────────────────┤
│ old.ts                   D   │          │ [ Commit 2 staged files    ] │ ← footer
│ HISTORY                      │          └──────────────────────────────┘
│ a1b2c3d  Fix the thing   pk  │
│ …28 more, always expanded    │
└──────────────────────────────┘
```

### 5.2 The problem being solved

Six zones are stacked unconditionally, in a column that is 280px wide by default and can
be dragged to 160px. Measured from the current CSS: the branch bar is about 34px
(`padding: 4px 8px`, line 1844, plus a 26px select), the commit block is about 100px
(`padding: 4px 8px 10px`, line 1856, a `min-height: 52px` textarea, line 1862, and a
primary button), and `.git-busy` (line 1866) inserts a further row that shoves everything
below it down whenever a git command runs. So on a fresh repo with two changed files,
roughly 134px of a 400px-tall panel is spent before the first filename, and the History
section below is fully expanded with up to 30 rows (`git:log` limit, line 46) whether or
not anyone asked for it.

Nothing is collapsible. Nothing is sticky. The commit box, which is used once per work
session, is permanently larger than the file list, which is looked at continuously.

### 5.3 Zones

**Header actions:** `reload` (refresh git state), and an overflow `⋯` (`more`) holding
the less-frequent operations: Stash, Fetch, Discard all. The overflow is a `context-menu`
reusing the existing pattern at line 630, not a new menu idiom.

**Toolbar zone (sticky):** the branch bar, rebuilt.

- The bare `<select>` (`GitPanel.tsx` lines 84 to 97) becomes a labelled button showing
  `<Icon name="branch" /> main` that opens a branch list, `flex: 1`, truncating with an
  ellipsis. It keeps `aria-label="Current branch"` (**this closes K7's labelling half**;
  the select has no accessible name today, unlike every other control in the panel).
  Keeping a real `<select>` and simply adding the `aria-label` is an acceptable smaller
  change if the branch list is not worth building in this batch; the label is not
  optional either way.
- Pull and Push (lines 100 to 120) become icon-only with their counts:
  `↓2` and `↑1`, 24 by 24, tooltips carrying the full sentence they carry today. Two
  labelled buttons plus a select do not fit in a 200px column, and the arrows plus a count
  are unambiguous once they are real icons instead of `↓` and `↑` characters.
- The one exception: when `git.upstream` is absent the push control keeps its word,
  **Publish**, because publishing a branch for the first time is not the same act as
  pushing and is rare enough to spend the width on. This preserves the distinction the
  current code already draws at line 118.

**Content zone:** commit composer, then three collapsible sections.

- **Commit composer.** Collapse the `min-height: 52px` textarea to a single-line input at
  rest (26px, `--row-header`) that expands to the 52px textarea on focus or whenever it
  has content. Same element, same `⌘Enter` handler (line 133), same placeholder. This
  recovers about 40px at rest without removing anything or moving it away from the top of
  the panel, where VS Code muscle memory expects it (Law 2).
- **Sections.** `Staged`, `Changes` and `History` each become a collapsible section whose
  header is a `<button aria-expanded>` containing a disclosure caret, the section name in
  sentence case at `--text-body`, and the count chip. Section headers are sticky within
  the content zone per section 1.2, so scrolling a long Changes list keeps its heading and
  count pinned under the toolbar.
  - `Staged` starts expanded, and auto-collapses when its count is 0.
  - `Changes` always starts expanded.
  - `History` starts **collapsed**. It is reference material, not work in progress, and it
    is currently the longest thing in the panel by a wide margin. Its count chip shows the
    number of commits loaded so a collapsed section is not a dead end.
  - Collapsed state persists per panel in `store.ts` alongside the other layout state, so
    a user who never wants History does not re-collapse it every launch.
- **Rows.** `.git-row` gains the section 2.2 grid: gutter, 16px leading icon slot (the
  file-kind icon, matching Explorer's), filename, dimmed directory (`.git-dir`, line 1910)
  truncating from the left so the meaningful end of a deep path survives, then the row
  actions, then the shared badge. The row actions stop being `opacity: 0`-until-hover only,
  per section 3.1 rule 3.

**Footer zone (sticky):** the commit button, and the busy line when a command is running.

- The commit button (lines 141 to 156) moves out of the content flow into the footer. Its
  three-way label logic is genuinely good writing and stays exactly as it is
  ("Commit 2 staged files" / "Stage all & commit (3)" / "Nothing to commit"). Pinning it
  means it is reachable after scrolling a long changes list, which is exactly when you
  want it.
- `.git-busy` (line 124, styles line 1866) renders in the same footer, replacing the
  button's row while a command runs rather than inserting a row and pushing the whole
  panel down.

### 5.4 Discard still calls native `confirm()` (closes K2)

`GitPanel.tsx` line 188 calls the browser's native `confirm()` inside the discard
`secondaryAction`. It is now the only native dialog left in the renderer: batch 9's D4
work has landed and `Explorer.tsx` already routes its delete through `Modal.tsx` (lines
299 to 323).

Route discard through the same component with the same shape, so the two most destructive
actions in the sidebar are confirmed identically:

- `<Modal variant="dialog" label={...} onClose={...} initialFocus={cancelRef}>`
- `.sheet-title`: `Discard changes to <b>{name}</b>?` for one file, or
  `Discard changes to <b>{n} files</b>?` for several.
- `.sheet-sub`: name the files. For one file, the path in a `<code>` element exactly as
  Explorer does. For several, list them, capped at five with "and N more".
- `.sheet-foot` / `.sheet-buttons`: a `ghost` Cancel and a `danger` Discard, default focus
  on Cancel via `initialFocus`.

Discarding is more destructive than deleting one file, since it can throw away
uncommitted work across several files at once, so it does not get a weaker confirmation
than delete does.

### 5.5 Empty states

Three exist and all three are bare strings (`GitPanel.tsx` lines 49, 50, 51, 199 and the
two `emptyHint` props at lines 170 and 192). Section 9 covers their copy.

---

## 6. Search (closes K13, and absorbs K5)

### 6.1 Before and after

```
BEFORE                                    AFTER
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Search                    ▤  │          │ Search              ⊘ │ ▤    │  ⊘ = clear
├──────────────────────────────┤          ├──────────────────────────────┤
│ ›[ Search in files, press …] │ ← chevron│ [ Search in files    ] Aa .* │ ← toolbar,
│                     Aa  .*   │   is the │ [ Replace with       ] [Repl]│   sticky,
│                              │   FIRST  ├──────────────────────────────┤   always
│ 128 results in 14 files      │   tab    │ src/renderer/App.tsx     3   │ ← sticky
│                              │   stop   │  42  const VIEWS = [         │   file head
│ src/renderer/App.tsx         │          │  57  { id: 'explorer', …     │
│  42  const VIEWS = [         │ ← file   │  61  { id: 'agents', …       │
│  57  { id: 'explorer', …     │   name   │ src/renderer/store.ts    2   │
│ src/renderer/store.ts        │   scrolls│  140 export type SidebarView │
│  140 export type SidebarView │   away   │  435 sidebar: SidebarView    │
│                              │          │                              │
│  (query box scrolls away)    │          ├──────────────────────────────┤
└──────────────────────────────┘          │ 128 results in 14 files      │ ← footer
                                          └──────────────────────────────┘
```

### 6.2 The replace chevron is removed, replace is inline

`SearchPanel.tsx` renders the show-replace toggle (lines 58 to 66) as the **first** child
of `.search-controls`, left of the query input. Three things are wrong with it at once: it
is the first tab stop in the panel, so a keyboard user meets an unlabelled `›` before they
meet the search box; it pushes the input right by about 26px permanently; and a chevron in
the leading position reads as a disclosure for the whole panel, not for one hidden field.

Remove it and render the replace row inline and always, as the second line of the toolbar
zone. The cost is 26px of permanent height in a panel that is otherwise empty until a
query runs. The gain is that the panel's second input stops being invisible, the tab order
starts at the thing you came here to type in, and one piece of state disappears from the
component.

`Replace all` stays disabled until there are results, with its existing explanatory
`title` (lines 113 to 117), which is already the right pattern and needs no change.

While in this row: the query input's placeholder (line 69) reads "Search in files, press
Enter" with an em dash in place of that comma today. That is the same house-rule
violation G3 removed from the Preview address bar, in a second file. Shorten it to
"Search in files" and let the empty-state hint in section 6.5 carry the "press Enter"
instruction, which is where an instruction belongs.

This supersedes K5's original instruction to migrate the `⌄` / `›` chevron onto the icon
system. There is no chevron to migrate. `Aa` and `.*` stay as short text labels: they are
legible as text, they are a real VS Code convention, and no line icon says "regular
expression" more clearly than `.*` does.

### 6.3 Zones

- **Header actions:** one, `Clear`, enabled only when there is a query or results. It
  clears the query, the replacement, and the result list in one press. There is no way to
  do this today short of selecting the field and deleting.
- **Toolbar zone (sticky, two rows, 52px):** query input plus `Aa` and `.*`, then the
  replace input plus `Replace all`. Sticky means the query you typed stays visible while
  you scroll 300 hits, which is the single most valuable thing this whole section does.
- **Content zone:** results grouped by file, as today (`byFile`, lines 50 to 53).
  `.search-file-name` (line 1992) becomes a sticky section header per section 1.2, at
  `--text-body` `font-weight: 600` per section 2.4, with a per-file match count chip on
  the right and a disclosure caret so a noisy file can be collapsed out of the way.
  The path truncates from the **left**, not the right (`direction: rtl` with
  `text-align: left`, or a `::before` ellipsis), so `.../renderer/components/Explorer.tsx`
  keeps the part that identifies the file.
- **Footer zone (sticky):** the results summary. `.search-summary` (lines 132 to 140)
  currently sits between the controls and the results, so it shoves the whole list down by
  about 18px the moment a search completes and scrolls away immediately afterwards. In the
  footer it neither moves the list nor disappears. The replace confirmation ("Replaced 12
  occurrences in 4 files", lines 124 to 130) renders in the same slot, replacing the count
  for a few seconds.

### 6.4 The row

`.search-hit` (line 2000) has no horizontal padding of its own and inherits
`.search-panel`'s `padding: 6px 8px` (line 1972), so its hover background is inset 8px
from the panel edge while `.tree-row`'s and `.git-row`'s bleed to it. Move the padding off
the panel and onto the rows: `.search-hit { padding: 0 var(--panel-gutter) }`, and the
hover, focus and selection backgrounds then match the other two panels exactly.

The 32px right-aligned monospace line number (`.search-line`, line 2011) is Search's
leading column and keeps its width, per section 2.2.

### 6.5 Empty state (closes K5's second half)

With no query, `results.length` is 0, `query` is empty and `searching` is false, so the
summary conditional at lines 133 to 139 renders an empty string and the panel below the
input is blank. Per Law 4, render a hint in the content zone, not the footer:

```
Search every file in this project.
Press Enter to run it. Aa matches case, .* reads the query as
a regular expression.
```

`var(--text-small)`, `var(--fg-dim)`, `var(--panel-gutter)` padding, `max-width: 300px`
matching `.panel-empty .hint` (line 600). Naming the two toggles here is the only place in
the app that ever explains what they do.

---

## 7. Behaviour at the sidebar's minimum width (closes K14)

`store.ts`'s `setPanelSize` (around line 858) clamps the sidebar to
`clamp(px, 160, window.innerWidth - 400)`. So the panels can be dragged to 160px and
nothing in any of them responds to it: at 160px the Source Control toolbar's select plus
two labelled buttons overflow, the Explorer header's four new action buttons plus the
title plus the hide button need about 190px, and Search's input compresses to nothing
between its chevron and its two toggles.

Two changes:

**Raise the floor.** Change the sidebar's minimum from 160 to **200** in `store.ts` around
line 864. 200px is the width at which the panel header holds a 15px title, four 24px
actions, the separator and the hide button without truncation. Below that the header, the
one zone shared by every panel, stops working, and a panel whose header does not work is
not a usable panel. The maximum clamp is unchanged.

**Respond between 200 and 260px.** Make `.sidebar` a query container and write one block,
not per-panel media queries:

```css
.sidebar { container-type: inline-size; container-name: sidebar; }

@container sidebar (max-width: 260px) {
  .panel { --indent-step: 8px; }       /* tighter tree indent, more room for names   */
  .git-dir { display: none; }          /* keep the filename, drop the directory      */
  .search-toggles { ... }              /* wraps to its own row under the input       */
  .section-header .count { ... }       /* count chip stays; it is the shortest thing */
}
```

Per panel, what survives and what goes, in priority order:

- **Explorer:** the badge and the filename always survive. The indent step drops to 8px.
  If the header's four actions still do not fit, Refresh and Collapse all move into an
  overflow `⋯`, New file and New folder never do.
- **Source Control:** the filename and the badge always survive; `.git-dir` is the first
  thing dropped; the row actions stay, since they are the reason the row exists. In the
  toolbar the branch name truncates and the sync counts stay.
- **Search:** the toggles wrap below the input rather than compressing it. The line number
  column always survives, since a hit without its line number is not actionable.

---

## 8. Finish the icon migration (closes K1)

Batch 2's glyph table covered the app's cross-cutting icons and never enumerated the ones
local to these three panels. Verified still present today:

| File | Line | Character | New `ICONS` name |
|---|---|---|---|
| `Explorer.tsx` | 213 | `🗀` new folder | `folderAdd` |
| `Explorer.tsx` | 222 | `↻` refresh | reuse `reload` |
| `Explorer.tsx` | 398 | `▾` / `▸` tree caret | `chevronDown` / reuse `forward` (Lucide `ChevronRight`) |
| `Explorer.tsx` | 401 | `📂` / `📁` / `📄` | `folderOpen` (reuse the existing `openFolder`) / `folder` / `file` |
| `Explorer.tsx` | 468 | `📁` / `📄` in the draft row | same two |
| `Explorer.tsx` | new | collapse all | `collapseAll` |
| `GitPanel.tsx` | 106 | `↓` pull | `pull` |
| `GitPanel.tsx` | 118 | `↑` push | `push` |
| `GitPanel.tsx` | 166 | `−` unstage | `unstage` |
| `GitPanel.tsx` | 181 | `+` stage | reuse `add` |
| `GitPanel.tsx` | 185 | `↺` discard | `discard` |
| `GitPanel.tsx` | new | overflow menu | `more` |
| `SearchPanel.tsx` | 65 | `⌄` / `›` | none, the control is removed, see section 6.2 |

`GitPanel.tsx` imports `Icon` for the first time. Check Lucide's set before adding a name
and reuse an existing `ICONS` entry wherever the meaning is the same: `reload` already
means "refresh this", `forward` is already `ChevronRight`, `add` is already `Plus`.

Keep per-extension file icons out of scope. One generic `file` glyph for every file
matches how the rest of the app treats "a file" as one concept, and a per-extension icon
set is a different project.

---

## 9. Empty-state copy across the three panels (closes K7's copy half)

Seven empty states exist across the three panels and no two share a voice. Each becomes a
short factual line, plus the next action where one genuinely exists (Law 4). Sentence
case, full stops, no em dashes.

| Where | Today | Becomes |
|---|---|---|
| `Explorer.tsx` 88 to 95, no folder | "No folder open" + hint + Open Folder | unchanged, this one is already right and is the model for the rest |
| `Explorer.tsx` 250, empty folder | "This folder is empty" | "This folder is empty." + New file / New folder buttons (section 4.5) |
| `GitPanel.tsx` 49, no folder | "No folder open" | "No folder open." + hint "Open a folder to see its changes here." + Open Folder, matching Explorer |
| `GitPanel.tsx` 50, not a repo | "Not a git repository" | "This folder is not a git repository." + hint "Metsuke tracks changes once it is." No action: initialising a repo is not a UX-audit decision, flag it rather than adding it here |
| `GitPanel.tsx` 51, loading | "Loading…" | "Reading git status." |
| `GitPanel.tsx` 170, nothing staged | "Stage a change below to include it in the next commit." | unchanged, this is good writing and names the next action |
| `GitPanel.tsx` 192, clean tree | "Working tree is clean." | unchanged |
| `GitPanel.tsx` 199, no commits | "No commits yet" | "No commits yet." |
| `SearchPanel.tsx` 16, no folder | "No folder open" | same treatment as GitPanel 49 |
| `SearchPanel.tsx` 137, no results | "No results" | "No matches for that query." plus, when `regex` is off, "Try .* to search by pattern." |
| `SearchPanel.tsx` 139, no query | renders an empty string | the hint in section 6.5 |

`.panel-empty`'s structure (lines 583 to 604) is the shape all of these use: a
`.empty-title` at `--text-panel`, a `.hint` at `--text-small`, and at most one action.
Panels currently returning a bare `<div className="panel-empty">string</div>` (GitPanel
49, 50, 51, SearchPanel 16) get the full structure.

---

## Do not touch

- `ThreadsPanel.tsx`, `ClaudePanel.tsx`, `AgentsPanel.tsx`, `PortsPanel.tsx`,
  `Preview.tsx`. Batch 11 and batch 8's territory. Section 1 constrains what batch 11
  builds; it does not license editing those files here.
- `App.tsx` beyond the `.sidebar-header` slot in section 1.1. The rail, the title bar, the
  layout control and the splitters are batch 4's and batch 9's settled work.
- The hide-sidebar gesture. Batch 9 closed D2 by drawing the header's hide control with
  the same `sidebar` icon the rail uses. Section 1.1 keeps that button, keeps its icon and
  keeps its position; it only adds a separator to its left.
- `Modal.tsx` itself. Section 5.4 uses it, it does not change it.
- The command registry entries `explorer.newFile`, `explorer.newFolder`,
  `explorer.openFolder`, `git.showChanges` from batch 3. This batch adds
  `explorer.collapseAll` and `search.clear` and otherwise consumes what is there.
- `Explorer.tsx`'s delete flow (lines 120 to 133, 299 to 323). It is D4's landed fix and
  is the pattern section 5.4 copies.
- `git:log`'s limit of 30 (line 46) and the `partition()` logic (lines 6 to 13). Section 5
  changes how those results are presented, not what is fetched.
- `Explorer.tsx`'s choice of which git state to show for a file (line 18). Section 3.3
  shares the badge, not the derivation.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`, then, in each of the three panels in turn: confirm the panel title, the
  panel's own actions and the hide-sidebar button all sit in the one 30px header row, with
  the hairline separating the panel's actions from the hide button.
- Scroll each panel to the bottom. The header, the toolbar zone and the footer zone must
  all still be on screen. Specifically: type a search query, scroll 300 hits, confirm the
  query box and the result count are both still visible.
- Switch Explorer to Source Control to Search with a ruler or a screenshot diff and
  confirm the left edge of the first text column does not move.
- Tab into each panel and arrow through it. Confirm every row shows the focus outline on
  top of its existing background, that a selected-and-focused row reads as both at once,
  and that Source Control's stage and discard buttons appear on the keyboard-focused row,
  not only on the moused-over one.
- Confirm the same file shows the same badge letter and colour in Explorer and in Source
  Control, including a renamed file, which currently disagrees (`R` versus `M`).
- Trigger discard and confirm the in-app dialog appears with focus on Cancel, and that no
  native browser dialog is reachable anywhere in the sidebar.
- Collapse and expand each Source Control section, restart the app, and confirm the
  collapsed state came back.
- Drag the sidebar to its minimum. Confirm the new 200px floor holds, that the Explorer
  header does not truncate its title, that Source Control drops the directory before the
  filename, and that Search's toggles wrap instead of crushing the input.
- Confirm no bare glyph is left: grep `src/renderer/components` for
  `🗀 ↻ ▾ ▸ 📂 📁 📄 ↓ ↑ − ↺ ⌄ ›` and expect zero matches in these three files.
- Check every empty state in the table in section 9 by putting the app into that state.
- `npm run test:ui`. Expect every sidebar baseline to change. Review each one.

## When done

Tick K1 through K14 in `PROGRESS.md`. Note there that section 1's panel anatomy is now a
standing contract, so batch 11 implements it rather than re-deriving one. Commit as:
`ux(batch-10): sidebar panel system`
