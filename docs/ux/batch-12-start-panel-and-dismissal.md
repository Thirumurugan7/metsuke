# Batch 12 - Start panel, rebuilt, and dismissal

Closes: M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M15. Reference:
`AUDIT.md` zone M (new), zone E (E1, E2, E4, whose closure batch 7 claimed and this batch
actually delivers), and batch 10 sections 1 through 3, whose row grammar this screen now
shares.

Depends on batches 1 through 11. Two dependencies are load bearing rather than nominal:
batch 10 section 3.4's `src/renderer/state/useListKeyNav.ts` is the keyboard handler this
screen uses, unchanged, and batch 9's `src/renderer/components/Modal.tsx` is the
confirmation dialog section 10.4 uses. Scope:
`src/renderer/components/StartPanel.tsx` (rewritten),
`src/renderer/components/TerminalPanel.tsx`,
`src/renderer/components/Preview.tsx`,
`src/renderer/App.tsx` (the global key handler only, see section 10.3),
`src/renderer/state/store.ts` (`closeTerminal` only, see section 10.5),
`src/renderer/state/commands.ts`,
`src/renderer/styles.css`.

**This batch supersedes batch 7's Start panel layout.** Batch 7's data work stands: the
`git:dirtyStat` channel, the `recentFiles` list in `store.ts` (lines 649 to 677) and the
last-report derivation are all correct and are reused as they are. What is replaced is
everything about how that data is arranged on screen. Batch 7's section 2 layout, its
`.start-*` CSS block (`styles.css` lines 1675 to 1773) and its notion that the primary
action is a centred button are all withdrawn here.

The second half of this batch is unrelated to layout and is here because it was reported
at the same time: a session, once open, has no working way to close itself, and neither
does the preview. Section 12 turns that into a standing law rather than two local fixes.

---

## 1. What is wrong with the screen that shipped

The user's words were "it's just a few words placed on the screen randomly" and "the
alignment is not making any sense". Both are accurate and both have specific causes. What
follows is measured against `styles.css` lines 1670 to 1773 and `StartPanel.tsx` as they
stand, not against the mock.

### 1.1 Two competing alignment axes (M1)

`.start-panel > *` (line 1680) centres every direct child and caps it at 560px, so the
project header, both section headings, the diff stat and the recent-file rows all share
one left edge. Then `.start-primary` (line 1748) sets `text-align: center`, and the
primary button plus the "or link · link" line under it (`StartPanel.tsx` lines 96 to 119)
snap to a second axis: the horizontal centre of that same 560px column.

So the top two thirds of the screen are read left to right from one edge, and the bottom
third is read outward from a centre point that lines up with nothing above it. Nothing on
the screen tells the eye which of the two is the real spine. **This is the single largest
cause of the "random" feeling, and it is one property in one rule.**

### 1.2 Nothing but the divider rules says where the column ends (M2)

A correction to the initial read, which said the dividers span the full pane. They do not.
`.start-section` (line 1697) is a direct child of `.start-panel`, so its `border-top`
inherits the 560px cap and the rules are exactly as wide as the column.

The defect is real but is one step in from that. Inside a 560px column, the rules are the
**only** element that reaches 560px. The header is about 200px of text. The section
headings are 24 and 26 characters. The longest recent-file row is around 285px. The
diff stat is under 200px. Every rule therefore draws a hard 560px line under content that
occupies at most half of it, and the eye reads the rule as the container edge and the text
as floating inside it, unaligned to anything on its right. A rule that is the widest thing
on a screen is a rule that is measuring a box nothing else fills.

### 1.3 The scaffolding outshouts the content (M3)

Measured:

| Element | Rule | Size | Weight | Colour |
|---|---|---|---|---|
| Section label, "Since you were last here" | line 1708 | `--text-panel`, 15px | 600 | `var(--fg)` |
| Section label, "Pick up where you left off" | line 1708 | `--text-panel`, 15px | 600 | `var(--fg)` |
| The diff stat those labels introduce | line 1714 | `--text-body`, 13px | 400 | `var(--fg-dim)` |
| A recent filename those labels introduce | line 1743 | `--text-body`, 13px | 500 | `var(--fg)` |

The labels are two steps larger, one step heavier and one step brighter than everything
they label. A section label is a signpost. It is the least interesting text in its own
section and it is currently the loudest. The comment above line 1705 argues for this on
the grounds that "these are the two things only this screen can show", which is an
argument about the sections, not about their labels.

### 1.4 One column position, three kinds of value (M4)

`StartPanel.tsx` line 89 renders the second column of a recent-file row as
`path.split('/').slice(0, -1).join('/')`, with no normalisation of any kind. That yields:

- `site` or `src/renderer/components` for a workspace-relative path with a parent,
- the empty string for a file at the workspace root, which renders as nothing at all,
- `/Users/prashant/Downloads/metsuke-clone` for any path that reached `recentFiles`
  absolute, which is what is on screen today.

Three different kinds of value in one column position: a relative folder, an absence, and
an absolute filesystem path longer than the filename it is meant to qualify. Scanning
down that column teaches the reader nothing, because there is nothing consistent to learn.

### 1.5 An indent that matches no step (M5)

`.start-recent-row` (line 1729) has `padding: 8px`. The `h3` above it (line 1708) has no
horizontal padding. So the file rows begin 8px to the right of the heading that owns them,
and 8px to the right of the project name, and 8px to the right of the diff stat, and 8px
to the right of the divider ends.

8px is not off scale in the abstract, it is `--panel-gutter`. It is off scale **here**,
because on this screen it is applied to exactly one of the five things sharing a left
edge, and it is written as a literal inside a padding shorthand rather than as the token,
so nothing signals that it was meant to relate to anything. A one-off 8px inset is how a
column stops looking like a column.

### 1.6 Top packed, bottom empty (M6)

`.start-panel` (line 1675) is `height: 100%; overflow: auto; padding: 48px 32px` with no
vertical distribution at all, so the content starts 48px from the top and simply stops
wherever it runs out. With the summary, three recent files and the action block, that is
roughly 380px of content in a pane that is commonly 700px or more tall. The user is
looking at about a third of the largest pane in the application holding nothing.

Note that the app already solves exactly this, one component away. `.welcome-inner` in
`components/onboarding.css` (lines 32 to 36) is `margin: auto; max-width: 560px; width:
100%` inside a `display: flex; justify-content: center; overflow: auto` parent (lines 22
to 31). The Start panel was written next to a working answer and did not use it.

### 1.7 Four idioms for one kind of thing (M7)

Everything on this screen is a thing you can act on. It is currently drawn four ways:

1. a paragraph of dim text with two coloured numbers in it (`.start-line`, line 1714),
2. a row with a bold-ish name and a dim path (`.start-recent-row`, line 1729),
3. a filled accent button 20px of icon tall (`.start-new-session`, line 1751, with
   `<Icon name="claude" size={20} />` at `StartPanel.tsx` line 102),
4. two underlined text links joined by a middle dot (`button.link`, line 1764).

Four treatments, four hit-target sizes, four hover behaviours, on a screen with at most
seven actionable lines on it. The screen has no visual grammar, so the eye has to
re-learn what is clickable four times on the way down.

### 1.8 The one statistic on the screen is a dead end (M8)

`.start-line` is a `<p>`. The diff stat cannot be clicked, and it is the only thing on the
screen that reports state rather than offering an action. "142 lines were added across 2
files" invites exactly one question, which is "which files", and the screen has no answer.
`git.showChanges` already exists in the registry (`commands.ts` lines 175 to 184) and
opens the Source Control panel. The stat should run it.

### 1.9 The prepared-task links are a second home (M9)

`SECONDARY_ACTION_IDS` (`StartPanel.tsx` line 11) puts `agent.checkProject` and
`agent.testUi` on this screen as underlined links, duplicating their entries in the
New-session menu (`TerminalPanel.tsx` line 15). Batch 5 section 3 and batch 7 section 2
both blessed the duplication, on the grounds that the Start panel was their primary home
and the menu a contextual shortcut.

**That decision is reversed here, at the user's explicit direction.** Two reasons, and the
second is theirs:

1. Once they were demoted from cards to underlined text links (which was the right call
   about their weight), they became a fourth visual idiom on a screen that could not
   afford a second. The cost of keeping them stopped being "a little duplication" and
   became "the screen has no grammar."
2. The user judges them redundant with the menu, which is now genuinely one click from
   anywhere the Sessions panel is visible and is also in `⌘K`. A prepared session is a
   session, and the menu is where you go to start a session.

They are **dropped from this screen entirely**. The New-session menu becomes their single
home, which is what Law 1 wanted in the first place. Update `AUDIT.md`'s F2 note and batch
5 section 3's closing paragraph so the "also appear as cards in the Start panel" claim
does not survive as a false statement in the record.

---

## 2. The content column

**One column, one left edge, 560px, centred in the pane.**

```css
.start-panel {
  display: flex;
  height: 100%;
  justify-content: center;
  overflow: auto;
  /* Asymmetric on purpose. See section 3. */
  padding: 32px 32px calc(32px + 6vh);
}
.start-column {
  margin: auto;
  max-width: 560px;
  width: 100%;
}
```

`.start-panel > *` (line 1680) is deleted. The cap moves off "every direct child" and onto
one named element, because the column is now a real thing with a name rather than a rule
that happens to apply to four unrelated siblings.

### 2.1 Why 560

560px is the value already in `.start-panel > *` (line 1682) and in `.welcome-inner`
(`onboarding.css` line 34). Keeping it is deliberate, not inertia. **The column width was
never the defect.** The defect was that nothing but the divider rules expressed it, so the
column read as accidental. Give the same 560px an explicit owner, hang every element off
its left edge, and the width starts doing the work it was always the right width for.

Checked against the longest content this screen can actually hold, at the 13px body face
where the average glyph is about 6.6px wide:

| Longest realistic line | Characters | Approx width |
|---|---|---|
| Recent file: `TerminalPanel.tsx` plus `src/renderer/components` | 40 | 285px |
| Recent file, worst realistic case: a 28-character filename plus a 44-character parent path | 74 | 500px |
| Diff stat row: `2 files changed` plus a right-aligned `+142 −38` | 25 | 210px |
| Start row: `New Claude session` plus a right-aligned `⌘⇧N` | 22 | 190px |
| Project title at `--text-display`, 28px: `metsuke-clone` plus a branch chip | 13 plus chip | 330px |

560px clears the worst realistic row with 60px of slack and clears the common case by
almost half the column. Going wider buys nothing: no line reaches 560px, so extra width is
extra emptiness to the right of every row, which is the M2 complaint restated. Going
narrower (520px) starts truncating the two-column recent-file row for a deeply nested
file, which is the M4 complaint restated. 560px is also the app's established reading
column, so the Start panel and the Welcome screen, the only two full-pane text surfaces in
the product, agree instead of each picking a number.

### 2.2 Both dividers are deleted

`.start-section`'s `border-top` (line 1698) and the `:first-of-type` exception (lines 1701
to 1704) both go. They are what makes the width feel undefined (M2), and with the column
now expressed by an actual element and a shared left edge, they have nothing left to do.
Section labels plus whitespace do the separating.

### 2.3 Nothing on this screen is centre aligned

Stated as a rule so it survives future edits: **no element inside `.start-column` uses
`text-align: center`, `margin-inline: auto`, `justify-content: center`, or any other
centring.** The column is centred in the pane. Everything inside it is flush left to the
column's left edge. That includes the project title, both section labels, every row, and
every row's leading icon.

---

## 3. Vertical placement

### 3.1 The mechanism

`margin: auto` on `.start-column`, inside a flex parent, not `align-items: center`. This
is the same idiom `.welcome-inner` already uses (`onboarding.css` line 33) and it is
chosen for a specific reason: an auto margin absorbs only **positive** free space. So:

- While the column is shorter than the pane, the free space splits between the auto
  margins and the column is vertically centred.
- The moment the column grows taller than the pane, the auto margins resolve to zero, the
  column pins to the container's `padding-top`, and `overflow: auto` on `.start-panel`
  scrolls it. Nothing is ever pushed off the top edge and made unreachable.

`align-items: center` gets the first behaviour and fails the second, clipping the top of
an over-tall child in a scroll container. Do not use it here.

### 3.2 The upward bias

Geometric centring reads as slightly low. The bias is applied through the container's
asymmetric padding, not through a transform or a negative margin on the column, so it does
not fight the auto margins or the overflow behaviour above:

```
padding: 32px 32px calc(32px + 6vh);
```

The auto margins split whatever is left after the padding, so the extra `6vh` at the
bottom moves the column up by half of it. On a 700px pane that is 21px, a roughly 44/56
split of the free space, which reads as centred rather than as deliberately raised. In the
overflow case the bottom padding simply becomes trailing scroll room, which is also what
you want.

### 3.3 The vertical rhythm inside the column

| From | To | Gap |
|---|---|---|
| Project title baseline block | first section label | 24px |
| Section label | first row of that section | 4px |
| Last row of a section | next section label | 20px |
| Row | row, within a section | 0, the rows are a contiguous 22px stack |

Rows do not get gaps between them. A gap between rows in the same list makes each row read
as its own object, which is the M7 defect coming back in a different form. Section gaps do
all of the separating, which is what makes the deleted dividers unnecessary.

---

## 4. The row idiom

**Every actionable line on this screen is the same unit.** One height, one left edge, one
set of states, three optional slots.

### 4.1 Anatomy

```
  ├────────────────── .start-column, 560px ──────────────────┤

  ┌────────┬─────┬──────────────────┬─────┬─────────────┬────────────┐
  │  icon  │ 8px │  primary label   │ 8px │  secondary  │    hint    │
  │  16px  │     │  13px  var(--fg) │     │ 12px fg-dim │ 12px fg-dim│
  └────────┴─────┴──────────────────┴─────┴─────────────┴────────────┘
  ↑                                                                  ↑
  x = the column's left edge.                    right aligned, flush
  Same x as the project title                    to the column's right
  and both section labels.                       edge.

  ├◄ 8px ►┤                                                  ├◄ 8px ►┤
  the hover wash bleeds 8px past the column on both sides, so the icon
  column starts exactly at x while the wash still has breathing room.
```

```css
.start-row {
  align-items: center;
  border-radius: 4px;
  display: flex;
  gap: 8px;
  height: var(--row);
  /* The wash is 576px wide, the content column is 560px, and the icon column
     still begins at exactly x. This is what keeps one left edge while giving the
     hover state somewhere to breathe. */
  margin: 0 calc(var(--panel-gutter) * -1);
  padding: 0 var(--panel-gutter);
  text-align: left;
  white-space: nowrap;
  width: calc(100% + var(--panel-gutter) * 2);
}
.start-row-icon {
  color: var(--fg-dim);
  flex: 0 0 var(--icon-col);
}
.start-row-label {
  color: var(--fg);
  font-size: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
}
.start-row-secondary {
  color: var(--fg-dim);
  font-size: var(--text-small);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.start-row-hint {
  color: var(--fg-dim);
  flex: 0 0 auto;
  font-size: var(--text-small);
  margin-left: auto;
}
```

### 4.2 Height

`var(--row)`, 22px, the same token every sidebar list row uses (`:root` line 41, and batch
10 section 2.2). This is deliberate and a taller row was considered and rejected: a second
row height in the app would be exactly the defect batch 10 spent its section 2 removing
one level down, and the sense of air on this screen comes from the section gaps and the
optical centring in section 3, not from fattening rows. A 22px row with a 16px icon is a
list row. This screen is a list.

### 4.3 The three optional slots

- **Leading icon.** Always present as a 16px slot, even when a row has no icon to draw,
  so the primary label starts at the same x on every row. Same rule as batch 10 section
  2.2's `--icon-col`.
- **Secondary label.** Dim, 12px, sits immediately after the primary label. One kind of
  value per column position: on this screen the secondary slot holds a **workspace
  relative parent directory** and nothing else. See section 5.3.
- **Trailing hint.** Right aligned via `margin-left: auto`, dim, 12px. Holds the row's
  trailing note: the keystroke that would do the same thing, or the number the row is
  about. Both are "one short thing that qualifies this row", which is why they can share a
  column position where the M4 values could not.

### 4.4 States

Reuse batch 10 section 3.1's matrix verbatim. Do not define a new one. The rows on this
screen are `role="option"` elements in a `role="listbox"` (section 7), so the global
`[role='option']:focus-visible` rule already in `styles.css` (around line 107, generalised
by batch 10 section 3.2) gives them their focus ring with no new CSS.

| State | Background | Text | Leading icon | Outline |
|---|---|---|---|---|
| Rest | none | `var(--fg)` | `var(--fg-dim)` | none |
| Hover | `var(--hover)` | `var(--fg)` | `var(--fg)` | none |
| Keyboard focused | `var(--hover)` | `var(--fg)` | `var(--fg)` | `2px solid var(--focus)`, `outline-offset: -2px` |
| Selected | not used on this screen: no row here is a persistent selection | | | |
| Disabled | none | `var(--fg-dim)` | `var(--fg-dim)` | none, plus `aria-disabled="true"` |

`.start-recent-row:hover` (line 1740) already uses `var(--hover)`, which is correct and
carries over. Nothing on this screen uses `--selected-bg`, because no row here represents
a thing you are currently on.

---

## 5. The three sections, in order

The project identity block is a heading, not a row. The three sections below it are lists
of rows, in this order, each omitted entirely when it has nothing to show.

### 5.1 Project identity (the page heading)

Not a row. It is the only display-sized text on the screen.

```
metsuke-clone   ⑂ UX-Edits
```

- Project name: `var(--text-display)`, 28px, `var(--fg)`, weight 600, flush to x.
- No leading folder icon. `<Icon name="openFolder" />` at `StartPanel.tsx` line 54 is
  deleted: at 28px the icon is the largest glyph on the screen, it pushes the project name
  off x by 16 plus 9 pixels so the heading no longer shares the column's left edge, and it
  says nothing the heading does not. The title bar's project switcher keeps its icon,
  where it is doing real work distinguishing a button from a label.
- Branch chip: unchanged, `.project-branch` (line 214), `--text-small`, `var(--fg-dim)`,
  with `<Icon name="branch" />`. It sits inline after the name with a 10px gap and is
  rendered only when `workspace.isGitRepo && git.branch`, as today (`StartPanel.tsx` lines
  56 to 61).

### 5.2 "Since you were last here"

Rendered only when there is something in it (batch 7's `showSummary` logic at
`StartPanel.tsx` line 49 is correct and is kept). Up to two rows.

**The diff row (closes M8).** Now a row, and clickable.

```
⑂  2 files changed                                    +142 −38
```

- Icon: `git`.
- Primary label: `{n} file{s} changed`, derived from `git.files.length` as today (line 40).
- Secondary: none.
- Trailing hint: `+{added} −{removed}` from `dirtyStat`, with `.diff-added` and
  `.diff-removed` keeping `var(--added)` and `var(--removed)` (lines 1853 to 1858).
- Activating it runs the registered command `git.showChanges` (`commands.ts` lines 175 to
  184), which calls `setSidebar('git')`. Do not call `setSidebar` directly. Reading the
  action out of the registry is what keeps this row and the palette entry from drifting,
  the same rule `TerminalPanel.tsx`'s `MenuCommandItem` (lines 201 to 224) already
  follows.

**The last-report row.** Rendered only when `lastReport` exists (line 44).

```
✳  Session that checks this project                        2h ago
```

- Icon: `agents`.
- Primary label: `lastReport.title`.
- Trailing hint: `age(...)` plus " ago", reusing `ThreadsPanel`'s exported `age()` helper
  exactly as batch 7 does (`StartPanel.tsx` lines 4 and 76).
- Activating it calls `setSidebar('agents')`.

The word "finished" in the current copy (line 76) is dropped. The row is in a section
called "Since you were last here" and the trailing column says "2h ago". A verb between
them is the third statement of the same fact.

### 5.3 "Pick up where you left off"

Up to 5 rows, from `recentFiles.slice(0, 5)` as today (line 86).

```
▤  TerminalPanel.tsx      src/renderer/components
▤  index.html
▤  store.ts               src/renderer/state
```

- Icon: `file`.
- Primary label: the basename.
- Secondary label: the parent directory, **always relative to the workspace root, never
  absolute** (closes M4).
- Activating it calls `openFile(path)`, unchanged.

**The derivation.** Put it in `StartPanel.tsx` as a module-level function, not inline in
the JSX:

```ts
/**
 * One column position, one kind of value (M4). Today's inline
 * `path.split('/').slice(0, -1).join('/')` produced a relative folder, an empty string,
 * or a full absolute path depending on which producer put the entry in `recentFiles`.
 * Normalising through the workspace root makes the answer the same shape whichever
 * producer it came from.
 */
function parentLabel(path: string, root: string): string {
  const rel = path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, '') : path
  return rel.split('/').slice(0, -1).join('/')
}
```

When the result is the empty string, the file sits at the workspace root and **the
secondary element is not rendered at all**. Not an empty `<span>`, not a `.`, not a `/`,
not a dash. The row is a filename with nothing after it, which is the true statement.
An empty span still occupies its 8px gap and leaves a hole in the column, which is how a
column of relative directories starts looking ragged again.

Do not "fix" this by normalising at the write site in `store.ts`'s `saveRecentFile` (lines
662 to 677) instead. Whatever is putting absolute paths into that list is worth finding,
but this batch's job is that the column reads consistently regardless, and the display-side
derivation is correct for both shapes. Note the absolute-path producer in `PROGRESS.md` as
a follow-up rather than chasing it here.

### 5.4 "Start"

One row.

```
✳  New Claude session                                       ⌘⇧N
```

- Icon: `claude`, at the standard 16px, not the 20px at `StartPanel.tsx` line 102.
- Primary label: read from the registry entry `session.new.claude` (`commands.ts` lines 76
  to 88), so the label here and in the New-session menu and in `⌘K` are the same string
  from the same place.
- Trailing hint: the command's own `shortcut` field, `⌘⇧N`, which the registry already
  carries (line 81). Do not hardcode the keystroke.
- Activating it runs the command, which calls `addTerminal('claude')`.
- When `!workspace` this row does not render at all, because the whole Start panel only
  mounts when `workspace` is truthy (`EditorPane.tsx` line 195). No disabled state is
  needed here.

**Why the primary action stops being a button.** All this action does is open a terminal
session, which is the same class of act as opening a file. `button.primary` at
`text-align: center` was making a promise about consequence that the action does not keep,
and it was the reason a second alignment axis existed at all (M1). As a row it is still the
most important thing on the screen: it is last, under its own label, with the only
keystroke hint on the page, and it is the row focused on mount (section 7).

---

## 6. Type and hierarchy (closes M3)

Exact tokens. Every one of these already exists in batch 1's `:root` block. Do not add a
new size, weight or colour for this screen.

| Element | Size token | Weight | Colour token |
|---|---|---|---|
| Project name | `var(--text-display)`, 28px | 600 | `var(--fg)` |
| Branch chip | `var(--text-small)`, 12px | 400 | `var(--fg-dim)` |
| Section label | `var(--text-small)`, 12px | 400 | `var(--fg-dim)` |
| Row primary label | `var(--text-body)`, 13px | 400 | `var(--fg)` |
| Row secondary label | `var(--text-small)`, 12px | 400 | `var(--fg-dim)` |
| Row trailing hint | `var(--text-small)`, 12px | 400 | `var(--fg-dim)` |
| Leading icon | 16px | n/a | `var(--fg-dim)` at rest, `var(--fg)` on hover or focus |

Three changes from what shipped, each reversing a specific line:

1. **Section labels drop two steps and go dim.** `.start-section h3` (line 1708) goes from
   `--text-panel`/600/`--fg` to `--text-small`/400/`--fg-dim`. They become the quietest
   text on the screen, which is what a signpost is.
2. **Row labels lose their bump.** `.start-recent-row .quick-open-name`'s `font-weight:
   500` (line 1743) goes. Body weight, primary colour. Weight is not needed to say "this
   is the content" once the label above it is dim.
3. **The project name goes up one step.** `.start-header`'s `--text-dialog` (line 1688)
   becomes `--text-display`, 28px, the token batch 1 defined with the comment "Welcome
   heading, future Start panel heading" and which this screen has never used. It is the
   only display-sized text here.

Do not use sentence-case-with-uppercase, letterspacing, or `text-transform` on the section
labels. That is the D1 defect, and batch 10 section 2.4 already had to remove it a second
time from `.section-header`. Three times is a pattern.

Also worth a one-line fix while in the neighbourhood: `.welcome-title` in
`onboarding.css` (line 38) is a hardcoded `font-size: 30px`, a leftover batch 1's sweep
never reached because that sweep was scoped to `styles.css`. Change it to
`var(--text-display)`. It is two files and one line, and leaving a fourteenth font size in
the app after batch 1 declared six is not worth the tidiness of scope.

---

## 7. Keyboard

**The whole screen is one list.** Not three lists that each have to be tabbed into.

- `.start-column` renders `role="listbox"` with an `aria-label` of "Start".
- Every row is a `<button role="option">` with a roving `tabIndex`, exactly one of which
  is `0` at any time.
- Section labels are `<div>`s outside the option sequence, with `aria-hidden="true"` on
  the label text and the section's own `role="group"` carrying `aria-label` so a screen
  reader still hears the grouping without the label becoming a stop.

Wire it with batch 10's hook, unchanged:

```ts
const onKeyDown = useListKeyNav({
  rowSelector: '[role="option"]',
  onFocusChange: setFocusedRow
})
```

`useListKeyNav` (`state/useListKeyNav.ts`) already reads rows from the DOM in render order
rather than from a model, which is precisely what makes arrow keys cross section
boundaries here for free: a section that did not render contributes no rows, so Down from
the last recent file lands on the New Claude session row whether or not the summary
section exists above. It already handles `ArrowUp`, `ArrowDown`, `Home`, `End`, and
`Enter`/`Space` to activate by calling `row.click()`. **Write no new key handler.**

Give each row a `data-id` so the hook's `onFocusChange` has something to report
(`useListKeyNav.ts` line 44 reads `dataset['id']` then `dataset['path']`).

**Default focus.** The New Claude session row is focused on mount. It is the reason the
screen exists, and a screen whose whole content is one list should have a cursor in it.
Focus it in a `useEffect` on mount, guarded so it does not steal focus back when the
component re-renders because `git` or `dirtyStat` resolved:

```ts
const didFocus = useRef(false)
useEffect(() => {
  if (didFocus.current) return
  didFocus.current = true
  startRow.current?.focus()
}, [])
```

Escape does nothing on this screen. There is nothing to dismiss: this is the pane's
resting state, not an overlay.

---

## 8. Empty and partial states

Every section is omitted entirely rather than shown empty. Batch 7 got this right for the
summary section and it is restated here because it now governs three sections rather than
one.

| Condition | What renders |
|---|---|
| No git repository (`workspace.isGitRepo` false) | No "Since you were last here" section, no label, no rows. The `git:dirtyStat` call is already guarded on this (`StartPanel.tsx` line 30) |
| A git repo with a clean working tree and no finished report | No "Since you were last here" section. `showSummary` (line 49) already computes this |
| A repo with changes but no report | The section renders with one row, the diff row |
| A report but a clean tree | The section renders with one row, the report row |
| `recentFiles` is empty | No "Pick up where you left off" section, no label, no rows, no "no recent files" line |
| Workspace opened for the first time: no repo, no recents, no reports | Project identity heading, then the "Start" section's single row, and nothing else. Roughly 90px of content, still optically centred by section 3, and the one row on it is focused |
| `dirtyStat` has not resolved yet | The section does not render. It appears when the promise resolves. No skeleton, no spinner, no "Loading…" row. The call is local and fast, and a row that appears is less disruptive than a row that changes identity |

**There is no all-empty state and there must not be one.** The screen's floor is the
project name plus one row that starts a session. That is a complete, honest, actionable
screen. Do not add an illustration, a "get started" paragraph, or a tips list to fill it.
Law 4 asks that an empty state carry the next action; this one is nothing but the next
action.

Note that this screen never handles "no folder open": `EditorPane.tsx` line 195 gates it
on `workspace`, and `App.tsx` line 301 renders `<Welcome />` for that case. That split is
batch 7's E3 fix and stays exactly as it is.

---

## 9. Before and after

### 9.1 The whole screen

```
BEFORE
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│      🗀 metsuke-clone  ⑂ UX-Edits                    20px / 600           │
│                                                                          │
│      Since you were last here                        15px / 600 / fg     │
│      +142 −38 across 2 files                         13px / fg-dim       │
│      ──────────────────────────────────────────────  560px rule, the     │
│                                                      widest thing here   │
│      Pick up where you left off                      15px / 600 / fg     │
│        TerminalPanel.tsx  site                       ← +8px indent       │
│        index.html                                    ← nothing           │
│        store.ts  /Users/prashant/Downloads/metsuke…  ← absolute path     │
│      ──────────────────────────────────────────────                      │
│                                                                          │
│                     ┌──────────────────────────┐     ← second axis       │
│                     │ ✳  New Claude session    │       starts here       │
│                     └──────────────────────────┘                         │
│               or Session that checks this project ·                      │
│                  Session that tests every screen     ← third idiom       │
│                                                                          │
│                                                                          │
│                                                                          │
│                  about a third of the pane, empty                        │
│                                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
    ↑ left edge of        ↑ centre axis of the same 560px column
      the 560px column
```

```
AFTER
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                                          │
│                                                                          │
│         ┌─── .start-column, 560px, margin: auto ────────────┐            │
│         │                                                    │           │
│         │ metsuke-clone  ⑂ UX-Edits                          │  28px     │
│         │                                                    │           │
│         │ Since you were last here                           │  12px dim │
│         │ ⑂  2 files changed                       +142 −38   │  22px row │
│         │ ✳  Session that checks this project        2h ago   │  22px row │
│         │                                                    │           │
│         │ Pick up where you left off                         │  12px dim │
│         │ ▤  TerminalPanel.tsx   src/renderer/components      │  22px row │
│         │ ▤  index.html                                      │  22px row │
│         │ ▤  store.ts            src/renderer/state           │  22px row │
│         │                                                    │           │
│         │ Start                                              │  12px dim │
│         │ ✳  New Claude session                        ⌘⇧N    │  22px row │
│         │                                                    │           │
│         └────────────────────────────────────────────────────┘           │
│                                                                          │
│                                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
          ↑
          one left edge. The project name, all three section labels,
          and every row's leading icon share this x. Nothing is centred.
```

### 9.2 The first-run floor

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                                                                          │
│                                                                          │
│                                                                          │
│         ┌────────────────────────────────────────────────────┐           │
│         │ some-new-folder                                    │           │
│         │                                                    │           │
│         │ Start                                              │           │
│         │ ✳  New Claude session                        ⌘⇧N    │  ← focused│
│         └────────────────────────────────────────────────────┘  on mount │
│                                                                          │
│                                                                          │
│                                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Closing a session (closes M10, M14, M15)

### 10.1 What the code actually says, which is not quite what was reported

The report was "once a session is open there is no way to close it from the session
itself; the only route is the toggle in the top right." Corrected against the source:

- `TerminalPanel.tsx` lines 114 to 124 **already render a `.tab-close` button** with an
  `<Icon name="close" />` on every session tab.
- Line 79 to 81 **already handle middle-click** to close via `onAuxClick`.
- `store.ts` line 1025 **already implements `closeTerminal`**, which kills the pty and
  reassigns the active tab.

So the mechanism is all there. What is broken is that it is invisible as an affordance:

**The reveal rule is written against the wrong class (M10).** `styles.css` lines 1821 to
1823 read:

```css
.tab:hover .tab-close,
.tab-close:hover { opacity: 1; }
```

`.tab` is the **editor** tab class (line 1790). A session tab is `.terminal-tab` (line
2501). It never matches. The only rule that reaches a session tab's close button is the
base `.tab-close` at line 1814, `opacity: 0.55`, so the × sits permanently at 55 percent
on every session tab, active or not, and never brightens when you hover the tab. A control
that is always half-there and never responds to the tab it lives in reads as decoration on
the tab, not as a button. That is the honest version of "there is no way to close it."

Two smaller faults in the same 10 lines:

- The tooltip says **"Close terminal"** (line 117). A5 retired "terminal" from user-facing
  copy in batch 9. It is "Close session", and the `aria-label` at line 116 already says
  the right thing.
- There is **no `⌘W`**. `App.tsx` line 163 binds `⌘W`, but only to `closeFile(activePath)`.
  With a session focused and no file open, `⌘W` does nothing at all.

### 10.2 The tab close control, drawn properly

Standard editor-tab behaviour, which is what Law 2 asks for:

| Tab state | Close control |
|---|---|
| Inactive, not hovered | Hidden, `opacity: 0`. The tab keeps the space reserved so nothing shifts when it appears |
| Inactive, hovered | `opacity: 1` |
| Active | `opacity: 1` always, hovered or not |
| Any tab, close button itself hovered or focused | `opacity: 1`, plus the standard `button:hover` wash |

```css
/* The reveal rule was written for `.tab` and never matched a session tab, so the ×
   sat permanently at 0.55 and read as part of the tab's decoration. */
.terminal-tab .tab-close { opacity: 0; }
.terminal-tab:hover .tab-close,
.terminal-tab.active .tab-close,
.terminal-tab .tab-close:hover,
.terminal-tab .tab-close:focus-visible { opacity: 1; }
```

Reserve the space rather than letting the tab reflow on hover: `.tab-close` keeps its
`padding: 3px 4px` (line 1818) and the 16px icon in flow at `opacity: 0`, so the tab's
width is identical in all four states. A tab strip that changes width as the mouse crosses
it is worse than no reveal at all.

Change the `title` at line 117 from `"Close terminal"` to `"Close session (⌘W)"`, using
the same `MOD` constant already at the top of the file (line 10).

Middle-click at lines 79 to 81 is correct as it stands. Keep it.

**And `.terminal-tab.active` (line 2515) moves from `var(--hover-strong)` to
`var(--selected-bg)` (M15).** It is the B5 defect a third time: selected drawn as a
stronger amount of the same wash as hover. Batch 1 fixed it on the rail, batch 10 fixed it
on `.tree-row`, and the session tab strip, the one place in the app where knowing which of
several things you are on matters most, still has it.

### 10.3 `⌘W` (M10)

`App.tsx`'s handler (lines 163 to 165) becomes context sensitive rather than
file-only:

```ts
} else if (key === 'w') {
  e.preventDefault()
  const s = useStore.getState()
  // Whichever surface has focus is what ⌘W closes. Focus inside the sessions panel
  // means the session; anything else means the file, which is what it always did.
  const inSessions = document.activeElement?.closest('.terminal-panel') !== null
  if (inSessions && s.activeTerminal) s.closeTerminal(s.activeTerminal)
  else if (s.activePath) s.closeFile(s.activePath)
}
```

Focus-scoped, not mode-scoped. `⌘W` with the cursor in an xterm closes that session;
`⌘W` with the cursor in the editor closes that file. This is what every editor does and
it needs no new state. Note that the xterm itself takes focus when a tab becomes visible
(`TerminalPanel.tsx` line 367), so "focus is in the sessions panel" is true in the normal
case without the user doing anything.

Register it as a command too, `session.close`, in the `Agent` section of `commands.ts`,
with `shortcut: '⌘W'`, `when: (s) => s.activeTerminal !== null`, so it is reachable from
`⌘K` and so the keystroke is declared in one place.

### 10.4 Confirming a close that would kill live work

`closeTerminal` calls `terminal:kill` on the pty unconditionally (`store.ts` lines 1026 to
1027). For a shell sitting at a prompt that is fine. For a Claude session mid-turn it
throws away work the user cannot get back.

Confirm when, and only when, the tab has a live process: `tab.sessionId !== null && tab.exitCode === null`. An exited tab (which the panel keeps around so you can read the
output and press Restart, lines 376 to 383) closes with no dialog.

Use batch 9's `Modal.tsx` with `variant="dialog"`. **Do not use `confirm()`.** That is the
D4 and K2 defect and this batch is not going to introduce a third instance of it.

```
┌────────────────────────────────────────────────┐
│  End this session?                             │
│                                                │
│  "check the router tests" is still running.    │
│  Closing it ends the process. Anything it has  │
│  not written to a file is lost.                │
│                                                │
│                        [ Cancel ]  [ End it ]  │
└────────────────────────────────────────────────┘
```

- Title: "End this session?"
- Body names the session by its tab title, so with four tabs open the user knows which one
  they are about to lose.
- Initial focus on **Cancel**, matching `Explorer.tsx`'s delete flow, which is D4's landed
  pattern and the one section 10 copies.
- Confirming calls the existing `closeTerminal`. The dialog gates the call; it does not
  reimplement it.
- Escape cancels, which `Modal.tsx` gives for free (lines 33 to 39).

This applies to all three close paths (the ×, `⌘W`, middle-click), so put the guard in
`TerminalPanel.tsx` as one `requestClose(id)` function that all three call, not three
copies of the same check.

### 10.5 What happens when the last session closes

Today, closing the last session leaves the Sessions panel showing `.terminal-overlay`
(`TerminalPanel.tsx` lines 178 to 191): "No sessions open" plus a `button.primary` reading
"Start a Claude session". Meanwhile the editor region above it is showing the Start panel,
which now has a "New Claude session" row in a section called "Start". **Two full-weight
empty states, 200px apart, both offering the same action, one as a filled accent button
and one as a row.** That is A8 exactly, and the button-versus-row split is M7 leaking out
of the screen this batch just fixed.

So: **when a user-initiated close removes the last session, the Sessions panel collapses.**
`closeTerminal` sets `terminalVisible: false` when the resulting `terminals` array is
empty. The window returns to the Start panel screen this batch redesigned, whose single
"New Claude session" row is then the one place on screen offering to start one. The loop
closes: the Start panel is where a session begins and where the last one ending returns
you to.

Three constraints on that:

- **Only on a user-initiated close.** A process merely exiting must not collapse the
  panel. `markTerminalExited` (lines 1063 to 1069) keeps the tab with an `exitCode` so the
  user can read the output and press Restart. Do not touch it.
- **`⌘J` and the title bar toggle still work.** Opening the panel deliberately with no
  sessions still shows `.terminal-overlay`, which is correct: the user asked for the panel,
  so the panel should explain itself. What is removed is the case where it shows up
  uninvited next to a screen making the same offer.
- **Fix the neighbour selection while in here (M14).** Lines 1032 to 1033 read:

  ```ts
  const activeTerminal =
    s.activeTerminal === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminal
  ```

  with the comment "Focus the neighbour rather than blanking the panel." It does not focus
  the neighbour, it focuses the **last tab in the strip**. Close the second of five tabs
  and focus jumps to the fifth. Compute the closed tab's index before filtering and select
  `Math.min(index, next.length - 1)`, which is the tab that slid into the closed one's
  position, or the new last tab when the closed one was last. That is what the comment
  already claims and what every editor does.

---

## 11. Closing the preview (closes M11)

`Preview.tsx`'s toolbar (lines 262 to 384) has back, forward, reload, an address input,
open-externally, Go, a width preset menu, Point at it, and fullscreen. It has no close
control. The only ways to dismiss the preview are all outside the preview:

- the layout control in the title bar (`App.tsx` lines 218 to 225),
- the status bar (`StatusBar.tsx` lines 62 to 65 is the terminal one; the preview's
  equivalent is reachable through the same group),
- the `view.togglePreview` command (`commands.ts` lines 208 to 216).

Three remote homes, zero local ones. Add a close button as the **last control in
`.preview-bar`**, after the fullscreen toggle:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ‹  ›  ↻  [ localhost:3000            ]  ↗  Go  Full ▾  ⌖ Point at it  ⛶  × │
└────────────────────────────────────────────────────────────────────────────┘
                                                                            ↑
                                                                       new
```

```tsx
<button
  className="icon-only preview-tool"
  title={`Close preview (${MOD}⇧V)`}
  aria-label="Close preview"
  onClick={() => togglePanel('preview')}
>
  <Icon name="close" />
</button>
```

- `.preview-tool` (line 2163) gives it the same 28px target the other icon buttons on this
  bar have, per G2. Do not use the bare `button.icon-only` default.
- Same `close` icon and same meaning as the session tab's ×, per Law 5.
- It calls the existing `togglePanel('preview')`. No new state and no new store action.
- Give the preview a real shortcut while doing this. `view.togglePreview` is the only one
  of the three view toggles with no keystroke: sidebar has `⌘B`, terminal has `⌘J`,
  preview has nothing, and its title-bar tooltip (`App.tsx` line 221) is the only one of
  the three that shows no shortcut. Bind `⌘⇧V`, declare it on the command, and put it in
  both tooltips.
- Not fullscreen-aware beyond the obvious: when `previewFullscreen` is true, Escape
  already exits fullscreen (line 245) and this × still closes the pane outright. Two
  different exits from two different things is correct; do not merge them.

---

## 12. The rule, and the rest of the app (closes M12, M13)

### 12.1 A seventh law

Add to `AUDIT.md`'s six laws:

> **7. Anything you can open, you can close from inside it.** Every surface a user can
> open carries its own dismissal, positioned within the surface itself. A toggle elsewhere
> in the chrome is a shortcut to that dismissal, never the only route to it. A user who
> has just opened something is looking at the thing they opened, not at the corner of the
> window that opened it.

This is Law 1 applied to dismissal, and it explains both halves of this section. It also
explains why the reported bug felt so much worse than the code suggested: the close
control existed but was drawn at 55 percent and never responded, so the user's actual
experience was of a surface with no exit, and the remote toggle in the title bar was the
only thing that visibly worked.

### 12.2 Every openable surface, audited

Checked every surface in the renderer that has an open path. Two violations, both fixed
above; the rest are listed so the audit is on record and nobody re-derives it.

| Surface | Opened by | Closed from within? |
|---|---|---|
| Session tab | Split button, `⌘⇧N`, palette, Start panel | **Broken, fixed in section 10.** The × exists but its reveal rule targets `.tab`, not `.terminal-tab` |
| Preview pane | Title bar toggle, status bar, `view.togglePreview` | **No, fixed in section 11** |
| Sessions panel (the panel, not its tabs) | Title bar toggle, `⌘J`, status bar, any `addTerminal` | **No. Out of scope, see 12.3** |
| Sidebar | Rail, `⌘B`, `⌘⇧E`/`⌘⇧G`/`⌘⇧F`/`⌘⇧A`/`⌘⇧C` | Yes. Hide button in the panel header (`App.tsx` lines 272 to 279), batch 9's D2 fix |
| Command palette | `⌘K` | Yes. Escape via `Modal.tsx` line 35, plus scrim click |
| Quick open | `⌘P` | Yes, same |
| Settings | `⌘,`, status bar | Yes, same |
| New session sheet | `agents.newSession` | Yes, same |
| Land session sheet | Agents panel | Yes, same |
| Guide | Status bar, Welcome | Yes. Close button (`Guide.tsx` line 203) plus Escape (line 182) plus scrim |
| Element comment | Point at it | Yes, Escape cancels inspect mode (`Preview.tsx` line 245) |
| Preview fullscreen | Fullscreen toggle | Yes. Escape plus a fixed-position exit, batch 8's G6 fix |
| Preview coach mark | First successful load | Yes. Its own dismiss button (`Preview.tsx` lines 371 to 375) |
| Telemetry consent | First run | Yes, its own controls |
| Toasts | Various | Self-dismissing, which counts |

### 12.3 The Sessions panel itself, flagged not fixed

`TerminalPanel.tsx` line 69 renders `<div className="terminal-header">Sessions</div>`, a
bare label. Every other named region in the window that can be hidden carries its own hide
control: the sidebar has one in its header, the preview will have one after section 11.
The Sessions panel has a title and nothing else, so hiding it means going to the title bar
or knowing `⌘J`.

The obvious fix is a hide button in `.terminal-header`, mirroring the sidebar's, with
`<Icon name="terminalPanel" />` to keep D2's "one gesture drawn one way" discipline. It is
deliberately **not** in this batch: `.terminal-header` currently has no actions slot, and
giving it one is the same "panel header with a title, an actions slot and a hide control"
problem batch 10 section 1 solved for sidebar panels. Doing it properly means deciding
whether the Sessions panel adopts batch 10's panel anatomy, which is a real design question
about a bottom-docked panel adopting a sidebar contract, not a button. Record it as M13 and
give it its own batch rather than a hurried third variant of a panel header.

---

## Do not touch

- `Welcome.tsx` and its no-folder state. E3 settled the split, `EditorPane.tsx` line 195
  and `App.tsx` line 301 implement it, and this screen never handles no-folder. The one
  exception is the single `font-size` line in `onboarding.css` named in section 6.
- The `git:dirtyStat` IPC channel and its handler. Batch 7 added it, it is correct, and
  this batch only changes how its two numbers are drawn.
- `store.ts`'s `recentFiles` mechanism (lines 649 to 677). Section 5.3 normalises at the
  display site on purpose. Do not change the write path.
- `store.ts` beyond `closeTerminal` (lines 1025 to 1036). Not `addTerminal`, not
  `markTerminalExited`, not `restartTerminal`, not `attachSession`.
- `TerminalPanel.tsx`'s `TerminalInstance` (lines 227 to 387) in full. The pty lifecycle,
  the StrictMode double-mount handling and the deliberate "does not kill the pty on
  unmount" comment (lines 298 to 303) are all load-bearing and hard-won.
- The New-session split button and its menu (lines 129 to 170). Batch 5's settled work.
  Section 1.9 removes the two prepared tasks from the **Start panel**, not from this menu,
  which is now their only home.
- `Modal.tsx`. Section 10.4 uses it, it does not change it.
- `useListKeyNav.ts`. Section 7 uses it, unchanged. If this screen appears to need a
  behaviour the hook lacks, that is a change agreed in batch 10 section 3.4, not a local
  copy of the hook.
- Batch 10's `--row`, `--panel-gutter` and `--icon-col` values. This screen consumes them.
  It does not get its own.
- `Preview.tsx` beyond adding the one button in section 11. The address bar, the width
  presets, Point at it, the coach mark, the progress bar and the `explain(code)` error copy
  are all batch 8's settled work, and the error copy is on the audit's protect list.
- `.tab` and the editor tab strip. Section 10.2 adds `.terminal-tab` rules; it does not
  change how editor tabs behave.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`, open a folder with uncommitted changes, a finished session report and at
  least three recent files, and close every file so the Start panel is showing. Then:
  - Put a ruler or a screenshot guide on the left edge of the project name. The section
    labels, every row's leading icon, and nothing else, must sit on that same x. Confirm
    no element on the screen is centre aligned.
  - Confirm both horizontal rules are gone.
  - Confirm the column sits slightly above the vertical centre of the pane, not at the top,
    and that the empty space below it is roughly the same as the empty space above.
  - Drag the editor region short enough that the column no longer fits. Confirm the column
    pins to the top and scrolls, and that the project name is still reachable at the top of
    the scroll rather than clipped above it.
  - Confirm every row is the same height, and measure it against a sidebar row in the
    Explorer: both must be 22px.
  - Confirm the recent-file second column shows a workspace-relative directory on every row
    that has one, nothing at all on a file at the root, and no absolute path anywhere. Test
    this specifically with a file opened from Search results and one opened from `⌘P`, which
    are the paths most likely to carry an absolute path in.
  - Click the diff-stat row. The Source Control panel must open.
  - Confirm the two prepared-task links are gone from this screen and still present in the
    New-session menu and in `⌘K`.
- Keyboard, on the same screen: confirm the New Claude session row has focus on first
  render. Arrow up and down through the whole screen and confirm focus crosses section
  boundaries in one continuous sequence, that Home and End reach the first and last rows,
  and that Enter on each row does what clicking it does. Confirm the focus ring is visible
  on every row in every theme, light included.
- Test the partial states by construction: a folder that is not a git repo (no summary
  section), a clean repo with no reports (no summary section), a freshly opened folder with
  no recents (only the heading and the Start row, still optically centred, still focused).
- `npm run dev` for dismissal:
  - Open four sessions. Hover each tab and confirm the × appears on hover, is always
    visible on the active tab, and that the tab does not change width when it appears.
  - Confirm the active tab now reads as selected by tint rather than by a slightly stronger
    hover wash. Compare it against a hovered inactive tab side by side.
  - Close the second of the four. Confirm focus moves to the tab that took its place, not
    to the last tab in the strip.
  - Close a session with `⌘W` while the terminal has focus. Then open a file, click into the
    editor, press `⌘W`, and confirm it closes the file, not the session.
  - Middle-click a tab and confirm it closes.
  - Close a Claude session that is mid-turn and confirm the in-app dialog appears, names
    that session by its tab title, opens with Cancel focused, and that Escape cancels.
    Confirm no native browser dialog is reachable from anywhere in the Sessions panel.
  - Let a session exit on its own, then close it. Confirm no dialog appears for a dead tab.
  - Close the last session. Confirm the Sessions panel collapses and the Start panel is
    the only thing offering to start a session. Press `⌘J` and confirm the panel comes back
    with its own empty state.
  - Confirm the preview's × closes the preview pane, that `⌘⇧V` does the same, and that the
    title-bar tooltip now names that shortcut.
  - With the preview in fullscreen, confirm Escape exits fullscreen and the × closes the
    pane, and that they remain two distinct actions.
- `npm run test:ui`. Expect new baselines for the Start panel, the session tab strip and
  the preview toolbar. Review each one.

## When done

Tick M1 through M15 in `PROGRESS.md`, marking M13 as flagged rather than fixed. Note there
that batch 7's Start panel layout is superseded and that batch 5 section 3's "also appear
as cards in the Start panel" sentence is no longer true. Commit as:
`ux(batch-12): start panel redesign and dismissal`
