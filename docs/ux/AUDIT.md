# Metsuke UX and UI audit

Full reference document for the `UX-Edits` branch. This is the source of truth; the
`batch-NN-*.md` files in this folder are execution specs derived from it. When a batch
file and this document disagree, this document wins — update the batch file, not the
other way round.

Companion artifact (visual version, screenshots and wireframes): ask Prashant for the
published link if you need the picture rather than the prose.

## The verdict

Metsuke has a VS Code body and a Claude Code soul, and the body is currently winning the
fight for screen space, hierarchy and attention. Everything that makes this product
different from VS Code — the agent, the preview, element picking, multi-session work —
sits at the edges of the window. The centre and the largest pane go to an editor that,
in this workflow, is mostly a reading surface, and by default it says "No file open."

Two structural faults generate most of the friction:

- **Duplication.** Open Folder exists in 5 places. Terminal toggle in 3. Ports in 3. Git
  in 3. The two canned agent tasks in 2 each, at opposite corners of the screen, with
  different labels. When one action lives in many places, users stop learning the app
  and start hunting it, every session.
- **Inverted hierarchy.** Four of five core jobs are about the agent. The agent gets a
  ~200px strip, an unnamed panel, and a launcher called "New." Nothing in the persistent
  chrome shows what the agent is doing right now.

## Seven laws (every batch must satisfy these)

1. **One job, one home.** Each action has exactly one canonical location. Anything else
   that fires it is a shortcut, styled at lower weight, never a competing equal.
2. **Familiar body, Claude soul.** Keep VS Code muscle memory for anything an editor
   already solved — tabs, tree, git, palette, shortcuts. Spend originality on the agent.
3. **State before controls.** The chrome's first duty is to answer "what is happening."
4. **Empty is an instruction to us.** Every empty state carries the next action, never
   just a description of the emptiness.
5. **A glyph means one thing.** One icon, one meaning, one family, everywhere at once.
6. **Name it as the user would.** Users have sessions, branches, pages — not
   attachments, instances, hooks.
7. **Anything you can open, you can close from inside it.** Every surface a user can open
   carries its own dismissal, positioned within the surface itself. A toggle elsewhere in
   the chrome is a shortcut to that dismissal, never the only route to it. A user who has
   just opened something is looking at the thing they opened, not at the corner of the
   window that opened it. (Added by batch 12; see zone M.)

## Region scorecard

| Zone | Region | Score | Headline problem |
|---|---|---|---|
| A | Global | Critical | No command surface, five names for one concept |
| B | Title bar | High | Prime real estate, four toggles, zero information |
| C | Activity rail | High | Six items of three different kinds, 9.5px labels |
| D | Sidebar | Medium | Two competing hide gestures, unlabelled toolbar |
| E | Editor | High | Largest pane, empty by default, instructs instead of acting |
| F | Sessions (terminal panel) | Critical | The protagonist, unnamed, behind a menu called "New" |
| G | Preview | High | The differentiator styled as a tertiary control |
| H | Ports | High | Chrome advertises the count it tells you to ignore |
| I | Status bar | Critical | Eleven items, five categories, one visual weight |
| J | Cross-cutting systems | — | Icons, type, colour, themes, motion |
| K | Explorer, Source Control, Search | High | Three panels built one at a time against no shared plan: no common anatomy, three different left edges, nothing sticky, and batch 2's icon sweep never reached them |
| L | Agents and Claude | Medium | Claude's usage/model surface buried a tab deep inside Agents, worth more than that |
| M | Start panel, and dismissal | Critical | The screen batch 7 built has two alignment axes, four row idioms and a third of its pane empty; and the two surfaces a user opens most, a session and the preview, cannot be closed from inside themselves |

## Findings registry

Severity: **Critical** blocks a core job or actively misleads · **High** costs real
friction every session · **Medium** real but tolerable. Fix is stated as an outcome, not
literal code — batch files translate it into files/lines.

### Zone A — Global structure and vocabulary

- **A1** (Critical) — One action, five homes. Open Folder/terminal-toggle/ports/git each
  appear in 3-5 places with different labels or glyphs. *Fix:* one canonical home per
  action; everything else is a lower-weight shortcut to it.
- **A2** (Critical) — No command surface. `⌘P` is files-only, no `⌘K`. *Fix:* command
  registry + palette (batch 3).
- **A3** (High) — Rail mixes project views (Files/Search/Git), a live system readout
  (Ports) and agent state (Threads/Claude) as visual peers. *Fix:* four rail items —
  Files, Search, Source Control, Agents.
- **A4** (Medium) — Title bar + status bar together cost 62px and answer neither "what
  is Claude doing" nor "what changed." *Fix:* title bar = identity/context, status bar =
  ambient truth.
- **A5** (High) — Five words for two concepts: terminal, session, thread, instance,
  subagent. *Fix:* only "session" (a running Claude) and "subagent" (runs inside one)
  survive in user-facing copy.
- **A6** (Critical) — Nothing in the chrome shows agent state; signal exists in hooks
  but never reaches persistent UI. *Fix:* agent status chip (batch 6).
- **A7** (High) — No Settings surface; theme picker lives inside the notifications
  dialog. *Fix:* Settings on `⌘,` with Appearance/Notifications/Project/Privacy.
- **A8** (High) — Three empty states shown at once on a fresh launch (editor, preview,
  ports list of unrelated processes). *Fix:* at most one empty state at full weight.

### Zone B — Title bar

- **B1** (Medium) — Open Folder (an action) grouped identically with three panel
  toggles (view state). *Fix:* separate groups, project switcher left, layout control
  right.
- **B2** (Medium) — Folder name is inert in the title bar, clickable in the status bar
  — backwards. *Fix:* title bar copy becomes the project switcher.
- **B3** (High) — `▤` means Sidebar and Terminal in the title bar, Files in the rail,
  terminal count in the status bar. *Fix:* icon system, batch 2.
- **B4** (High) — The most prominent bar carries no live information. *Fix:* project +
  branch + agent chip.
- **B5** (Medium) — Active toggle state (`--hover-hard`, 13% wash) is nearly identical
  to hover (`--hover-strong`, 10% wash). *Fix:* selected state uses a different property
  than hover, not a stronger amount of the same one.

### Zone C — Activity rail

- **C1** (High) — Rail labels at 9.5px, below legibility floor. *Fix:* 11px minimum.
- **C2** (High) — `⚓` (ports, a pun), `◆` (threads, arbitrary), `✳` (Claude, reads as a
  terminal spinner) don't encode their meaning. *Fix:* icon system, batch 2.
- **C3** (Medium) — Badges use accent colour, diluting what accent means. *Fix:*
  neutral chips for counts; accent reserved for "the thing you are on."
- **C4** (High) — Ports rail badge shows 9 (includes system ports); panel then hides 6
  of them as noise. *Fix:* badge the interesting count only.
- **C5** (Medium) — Six rail destinations of three different kinds is past where a rail
  helps. *Fix:* four items.

### Zone D — Sidebar and Explorer

- **D1** (Medium) — "EXPLORER" header: 11px, uppercase, letterspaced, dim — removes
  word shape, reads as decoration not label. *Fix:* sentence case, 12px, full contrast.
- **D2** (Medium) — Both the `×` in the panel header and re-clicking the active rail
  icon hide the sidebar, with no visual relationship between the two gestures. *Fix:*
  one documented gesture.
- **D3** (Medium) — Explorer toolbar is unlabelled glyphs, one of them `▤` again, new
  file/folder share one `+`. *Fix:* distinct icons, registered as commands.
- **D4** (Medium) — Delete uses native `confirm()`, the one place the app breaks its
  own visual language. *Fix:* in-app confirmation sheet.

### Zone E — Editor region

- **E1** (High) — Largest pane on screen is empty by default ("No file open"), despite
  this being the common state in an agent workflow. *Fix:* Start panel (batch 7).
- **E2** (High) — Empty state says "pick a file from the Explorer" — points elsewhere
  instead of acting. Its one button duplicates `⌘P`. *Fix:* recent files as clickable
  rows.
- **E3** (Medium) — Two different empty states for the same slot (EditorPane's own vs.
  Welcome.tsx) with different tone and content. *Fix:* one no-folder state.
- **E4** (Medium) — No "what happened while I was away" summary, despite git status,
  thread diff stats and subagent reports all already being computed. *Fix:* surface
  them in the Start panel.

### Zone F — Sessions (the terminal panel)

- **F1** (Critical) — `＋ New ▾` doesn't say new *what*; the common case (start a Claude
  session) costs two clicks. *Fix:* split button, batch 5.
- **F2** (Critical) — The menu mixes nouns ("Claude session", "Shell") with imperative
  commands ("Run project check", "Test UI end to end") and a persistent settings
  checkbox, so it reads as a junk drawer. *Fix (revised, see `batch-05`):* keep the
  tasks in the menu — they genuinely do start a session, just with a prepared prompt —
  but rephrase every entry as a noun so the list is one kind of thing: "Session that
  checks this project", "Session that tests every screen", below a separator. The
  checkbox still moves to Settings. ~~The two prepared sessions also appear as cards in
  the Start panel, which is their primary home; the menu entry is a contextual shortcut
  to the same registered command.~~ **Superseded by M9 (batch 12): the two prepared
  sessions are dropped from the Start panel entirely, and this menu is now their single
  home, which is what Law 1 wanted in the first place.**
- **F3** (Medium) — "Check project on open" is a persistent preference living inside a
  menu that closes on any outside click. *Fix:* Settings, Project section.
- **F4** (High) — Session creation only exists while the terminal panel is visible, and
  is disabled with no explanation when no folder is open. *Fix:* reachable from
  palette/Start panel/Agents view regardless of panel visibility; disabled states state
  the reason.
- **F5** (High) — Every Claude tab is named "claude" — unusable once more than one is
  open. *Fix:* derive name from prompt/task, allow rename.
- **F6** (Medium) — Tab dot encodes kind (Claude vs shell), which the name already
  shows, not state (working/waiting/done), which is the useful thing. *Fix:* kind → icon,
  state → dot.
- **F7** (Critical) — The panel that runs the agent has no name, no header — the only
  unlabelled region in the window. *Fix (batch 5):* rename "Sessions," give it a header.
  **Reversed in a later pass:** the diagnosis was right, the fix treated the symptom. A
  standing heading cost a full row in the shortest region in the app; once F5 landed and
  tab names said what they were, the tab strip alone named the region as clearly as VS
  Code's own panels and every terminal app do it through their tab strip, no separate
  row needed. The heading is gone, the tab strip is the header, `aria-label="Sessions"`
  keeps the name for a screen reader, and the tab row's right end carries a hide control
  so the panel keeps a self-dismissal now that its header doesn't have one. This does
  not apply to the sidebar panels (Explorer, Source Control, Search, Agents, Claude) —
  those are tall and narrow, where a standing header costs comparatively little; this
  panel is short and wide, where the same row is a much larger fraction of its height.
  See `batch-05-sessions-panel.md` section 1 for the fuller reasoning.

### Zone G — Preview

- **G1** (Critical) — Element-picking, the product's strongest differentiator, is a
  small ghost button labelled "Select" between Go and fullscreen, disabled until a page
  loads, no shortcut, never explained. *Fix:* promote to primary toolbar control, batch 8.
- **G2** (Medium) — Back/forward/reload/fullscreen are bare 11px glyphs in 22px targets
  — under any reasonable hit-target guidance. *Fix:* real icons, 28px targets.
- **G3** (Medium) — Address placeholder "localhost:3000 — or just a port number" both
  truncates at default width and contains an em dash (against house rules). *Fix:*
  shorten to `localhost:3000`.
- **G4** (High) — `PortsPanel` is mounted in both the preview footer and the sidebar
  simultaneously — same list, different chrome, no indication they're the same thing.
  *Fix:* ports live only inside Preview.
- **G5** (High) — "○ Not attached" / "Claude preview idle" describe an internal flag,
  read as a fault, shown by default, shown twice. *Fix:* say nothing until true; one
  positive statement when true.
- **G6** (Medium) — Fullscreen preview hides the rail with no announced exit besides a
  small glyph and Escape. *Fix:* fixed-position exit + brief "Press Esc to exit" hint.
- **G7** (Medium) — No loading indicator beyond the reload icon swapping glyphs; a slow
  dev-server compile reads as nothing happening. *Fix:* thin progress bar driven by the
  existing `loading` state.
- **G8** (Medium) — No way to open the current preview URL in a real browser from the
  address bar, only from the ports list once H3 lands. *Fix:* external-open button next
  to the address input.
- **G9** (Medium) — No responsive-width presets; checking a mobile layout means
  resizing the whole preview panel, which also resizes the editor. *Fix:* a small
  width-preset control (Full/Tablet/Mobile) local to the preview pane.

### Zone H — Ports

- **H1** (High) — Rail badge and status bar both count 9 ports; panel shows 3 and hides
  6 as noise — every visible number is the wrong one. *Fix:* count only the usable set,
  everywhere.
- **H2** (Medium) — Visible rows are often unrelated processes (`java`,
  `figma_agent`), not the project's own dev server. *Fix:* rank by relevance:
  started-here first, then HTML-serving, then everything else collapsed.
- **H3** (Medium) — "open ↗" (external-link convention) actually loads in the internal
  preview. *Fix:* primary label "Preview"; separate `↗` opens the real browser.
- **H4** (High) — No liveness probe, so users routinely click a port that can't serve
  web pages and hit the (well-written) error state. *Fix:* one HEAD request per
  candidate, label accordingly.

### Zone I — Status bar

- **I1** (Critical) — Eleven items spanning five semantic categories (navigation,
  state, actions, toggles, app-level) at one visual weight, one spacer, no grouping.
  *Fix:* three groups — project truth / agent / system — batch 4.
- **I2** (High) — Buttons and static labels are visually identical until hover. *Fix:*
  persistent affordance on anything clickable.
- **I3** (High) — "Claude preview idle" is a permanent negative in implementation
  language, duplicated with the preview footer pill. *Fix:* remove; replaced by the
  agent status chip.
- **I4** (High) — Six of eleven items duplicate the rail or title bar. *Fix:* remove
  duplicated navigation, keep only continuous-need information.
- **I5** (Medium) — No separators, one spacer splitting left/right, no relationship
  between neighbouring items. *Fix:* hairline separators between semantic groups.
- **I6** (Medium) — App-level items (Guide, Alerts, update) interleaved with
  project/session items. *Fix:* collapse into one settings control.

### Zone J — Cross-cutting systems

- **J1** (High) — Thirteen font sizes in use (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13,
  14, 15, 17, 26px), no defined scale. *Fix:* six sizes with named roles, batch 1.
- **J2** (Critical) — Three incompatible icon families at once: full-colour emoji,
  geometric Unicode, arrows/typographic marks. *Fix:* one inline-SVG line-icon set,
  batch 2.
- **J3** (Medium) — Two different modal idioms (`.overlay`/`.quick-open` vs.
  `.sheet-scrim`/`.sheet`) with different geometry and dismissal behaviour. *Fix:* one
  overlay system, two sizes.
- **J4** (High) — 5 of 7 themes are fandom skins; no follow-system option; no high
  contrast theme, despite the `themes.ts` architecture being well built and already
  shipping a contrast-ratio function. *Fix:* add follow-system (default) + high
  contrast; group fandom themes under "More."
- **J5** (High) — Accent colour carries four meanings at once (active rail item, badge
  ground, primary button, focus ring). *Fix:* accent means "the thing you are on";
  focus/badges/semantic states get their own tokens.
- **J6** (Medium) — 1px splitters with an invisible-until-hover affordance; users don't
  discover panels are resizable. *Fix:* visible hover/drag state, ≥8px hit area.

### Zone K — Explorer, Source Control, and Search

- **K1** (High) — Explorer's new-folder/refresh toolbar buttons, its tree-row folder/
  file glyphs, and GitPanel's pull/push/stage/unstage/discard controls all still render
  bare characters or emoji — batch 2's glyph table never enumerated these, panel-local
  ones. *Fix:* extend the Icon system, batch 10.
- **K2** (Critical) — GitPanel's discard-changes action still calls the browser's native
  `confirm()`, the same violation D4 removes from Explorer's delete flow, in a second
  file D4's scope never covered. *Fix:* route through the same in-app confirmation.
- **K3** (Medium) — `.tree-row` defines `:hover` and `.active` but no `:focus-visible`;
  a keyboard user arrowing through the tree can't see where they are unless the row is
  also the open file. *Fix:* focus-visible outline using the `--focus` token.
- **K4** (Medium) — The same seven git states are rendered by two independent, slightly
  disagreeing implementations: Explorer's `tree-badge` and GitPanel's `git-letter`.
  *Fix:* one shared status-badge function.
- **K5** (Medium) — Search's toggle glyphs weren't migrated to the icon system, and the
  panel is a bare input with no guidance until a query is typed, violating Law 4.
  *Fix:* icon-based chevron, a hint line when empty.
- **K6** (Medium) — Search results and Git's changed-file rows aren't keyboard-navigable
  the way Explorer's tree already is — one Tab stop at a time, no arrow-key roving.
  *Fix:* reuse Explorer's roving-tabindex pattern via a shared hook.
- **K7** (Medium) — GitPanel's branch selector has no `aria-label`; empty-state copy
  voice and completeness (does it name a next action?) differs across all three panels
  for functionally the same "nothing here" message. *Fix:* label the control, align
  empty-state shape with the rest of the app's Law-4 discipline.
- **K8** (High) — No shared anatomy for a sidebar panel. Each of the three invented its
  own structure, so Explorer grew a second toolbar row while Source Control and Search
  have none, and `.sidebar-body`'s single `overflow: auto` scrolls every control away
  with the content it controls. *Fix:* one four-zone skeleton (header, toolbar, content,
  footer) with defined sticky behaviour, binding on every sidebar panel including batch
  11's. Batch 10 section 1.
- **K9** (High) — Row height agrees across the three panels (all 22px) but nothing else
  does: text columns start at 38px, 8px and 48px in a 280px column, empty states indent
  4px further than the rows they replace, the tree indent step is an inline style in
  JSX, and `.section-header` is still uppercase/letterspaced/dim, the exact D1 defect one
  level down. *Fix:* one horizontal grid and one type ladder in tokens, with five new
  layout tokens added to batch 1's block.
- **K10** (High) — A sidebar row has three visual states where it needs eight. Selected
  is a stronger hover wash rather than a different property (B5, one level down); git and
  search rows cannot receive focus at all; row actions are `opacity: 0` until mouse
  hover, so stage, unstage and discard do not exist for a keyboard user. *Fix:* a
  normative state matrix, token per state, focus additive over selection.
- **K11** (Medium) — Explorer's toolbar is a second, right-aligned row inside the scroll
  container, so its buttons scroll away from the files they act on, and there is no
  collapse-all in a tree that can nest indefinitely. *Fix:* actions move into the panel
  header's actions slot, plus collapse-all.
- **K12** (Medium) — Source Control stacks six always-on zones with no collapsing and no
  priority. About 134px of a 400px panel is spent on the branch bar and commit box before
  the first changed filename, History is fully expanded to 30 commits by default, and the
  busy line shoves the whole panel down when a git command runs. *Fix:* collapsible
  sections with counts, a commit field that grows on focus, commit button and busy line
  pinned to a footer.
- **K13** (Medium) — Search's replace toggle is the panel's first tab stop, an unlabelled
  chevron left of the input that displaces it; the query box and the result count both
  scroll away with the results; hit rows are inset 8px from the panel edge while every
  other panel's rows bleed to it. *Fix:* replace shown inline, toolbar and summary made
  sticky, rows aligned to the shared gutter.
- **K14** (Medium) — The sidebar clamps to a 160px minimum and no panel responds to it:
  at that width the panel header, the one element every panel shares, cannot hold a title
  and its actions. *Fix:* raise the floor to 200px and define what each panel drops
  between 200 and 260px, via one container query rather than per-panel media queries.

### Zone L — Agents and Claude

- **L1** (High) — Claude's usage/model/skills surface is buried as the second tab of
  the "Agents" rail item (per batch 4's merge), one click deeper than every other
  panel, for a surface substantial enough to earn its own destination. *Fix:* Claude
  becomes its own rail item; this deliberately reopens C5/A3's four-item rail count to
  five. See batch 11.
- **L2** (Medium) — ThreadsPanel's land action, subagent-indent arrow, and report-toggle
  caret are bare characters batch 2's sweep never reached. *Fix:* extend the Icon
  system, batch 11.
- **L3** (Medium) — ClaudePanel's "Recount" button has the same bare-refresh glyph gap
  as K1, in a fourth file. *Fix:* same icon, reused here.
- **L4** (Medium) — The "This project" usage tab is disabled with no explanation when no
  folder is open, unlike the `blockedBy`-string convention established elsewhere.
  *Fix:* a `title` naming the reason.
- **L5** (Medium) — Sending a model change to a running session gives no confirmation of
  which session received it when more than one is open. *Fix:* brief inline
  confirmation naming the tab.

### Zone M — Start panel, and dismissal

Zone M opened after batch 7's Start panel shipped and was seen. Its data work was right;
its layout was not, and it never got the close read the sidebar panels got in zone K.
**Batch 12 supersedes batch 7's Start panel layout in full** — batch 7's section 2 layout,
its `.start-*` CSS block and its centred primary button are all withdrawn. Batch 7's IPC
channel, `recentFiles` store work and "since you were last here" derivation stand
unchanged. M10 through M15 are a separate complaint reported at the same time and are in
this zone because Law 7 came out of them.

- **M1** (Critical) — Two competing alignment axes on one short screen: everything above
  the last divider is flush left in a 560px column, the primary button and its two links
  are centred inside that same column. The largest single cause of the screen reading as
  unplanned. *Fix:* one column, one left edge, nothing centred (batch 12 section 2).
- **M2** (High) — Nothing but the divider rules expresses the content column. The rules
  are the only element that reaches the column's full 560px; every piece of content is at
  most half that, so the rule reads as a container edge and the text as floating inside
  it. *Fix:* give the column a real element, delete both dividers, let section labels and
  whitespace separate.
- **M3** (High) — Inverted hierarchy: the two section labels render at 15px/600/`--fg`
  while the content they label is 13px/400-500/`--fg-dim`. Scaffolding two steps larger,
  one heavier and one brighter than its own content. *Fix:* labels drop to
  `--text-small`/400/`--fg-dim`; row labels sit at body weight in `--fg`; the project
  title becomes the only `--text-display` text on the screen.
- **M4** (Medium) — One column position, three kinds of value. The recent-file row's
  second column holds a relative folder, nothing at all, or a full absolute path,
  depending on which producer put the entry in `recentFiles`. *Fix:* always the parent
  directory relative to the workspace root; render no element when it is empty.
- **M5** (Medium) — The file rows are inset 8px from the heading, the project name, the
  stat line and the divider ends, because `.start-recent-row` carries `padding: 8px` as a
  literal in a shorthand and nothing else on the screen carries any. *Fix:* one shared
  left edge; the row's hover wash bleeds outside the column instead of insetting content.
- **M6** (High) — Top-packed with dead space: about 380px of content anchored 48px from
  the top of a pane commonly 700px tall, with no vertical distribution at all. The app
  already solves this one component away in `.welcome-inner`. *Fix:* optical vertical
  centring via `margin: auto`, with asymmetric container padding for the upward bias, and
  pin-to-top-and-scroll once content overflows.
- **M7** (High) — Four visual idioms for one kind of thing. A dim paragraph, a two-column
  row, a filled accent button and two underlined text links, on a screen with at most
  seven actionable lines. *Fix:* one row idiom for everything, reusing batch 10's row
  grid, row height and state matrix.
- **M8** (Medium) — The one statistic on the screen is a `<p>`. "+142 −38 across 2 files"
  invites exactly one question and the screen has no answer, though `git.showChanges` is
  already in the registry. *Fix:* the stat becomes a row that opens Source Control.
- **M9** (Medium) — The two prepared-task actions have a second home here, duplicating
  the New-session menu, and as underlined links they are a fourth idiom on a screen that
  could not afford a second. *Fix:* dropped from this screen entirely; the New-session
  menu becomes their single home. **This reverses batch 5 section 3's and batch 7 section
  2's "primary home here, shortcut in the menu" decision, at the user's explicit
  direction.** Update F2's note accordingly.
- **M10** (Critical) — A session cannot be closed from itself in practice. The `×` and
  the middle-click handler both exist in `TerminalPanel.tsx`, but the reveal rule
  (`.tab:hover .tab-close`) targets the editor tab class and never matches a session tab,
  so the `×` sits permanently at `opacity: 0.55` and never responds to its own tab. `⌘W`
  is bound to files only and does nothing with a session focused, and the tooltip still
  says "terminal" after A5 retired the word. *Fix:* proper hover/active reveal on
  `.terminal-tab`, a focus-scoped `⌘W`, corrected copy, and a `Modal.tsx` confirmation
  when the session has a live process.
- **M11** (High) — The Preview pane has three remote dismissal routes (title bar layout
  control, status bar, `view.togglePreview`) and no control of its own. It is also the
  only one of the three view toggles with no keyboard shortcut. *Fix:* a close control at
  the end of the preview's own toolbar, plus `⌘⇧V`.
- **M12** (High) — Stated as Law 7: any surface a user can open must be dismissible from
  within itself, never only from a remote toggle elsewhere in the chrome. The reported bug
  felt far worse than the code suggested precisely because of this: a control existed but
  was drawn at 55 percent and never responded, so the only thing that visibly worked was
  the toggle in the opposite corner of the window.
- **M13** (Medium) — The Sessions panel itself has a bare title and no hide control, so
  hiding it means the title bar or knowing `⌘J`. Every other hideable named region carries
  its own. *Flagged, not fixed in batch 12:* `.terminal-header` has no actions slot, and
  giving it one is the same problem batch 10 section 1 solved for sidebar panels. Deciding
  whether a bottom-docked panel adopts that contract deserves its own batch, not a hurried
  third variant of a panel header.
- **M14** (Medium) — `closeTerminal`'s comment says "focus the neighbour" and the code
  selects `terminals.at(-1)`. Closing the second of five tabs jumps focus to the fifth.
  *Fix:* select the tab that slid into the closed one's position.
- **M15** (Medium) — `.terminal-tab.active` uses `--hover-strong`, drawing selected as a
  stronger amount of the same wash as hover. This is B5 a third time, in the one strip
  where knowing which of several things you are on matters most. *Fix:* `--selected-bg`,
  the token batch 1 added for exactly this.

## What to protect (do not regress these while implementing)

- The preview's `explain(code)` error copy in `Preview.tsx` — genuinely better error
  writing than most shipped products.
- The New-thread sheet's cost disclosure ("It does not share context back...") — states
  the tradeoff at the point of decision, keep this pattern anywhere similar is added.
- Sessions surviving reload/restart via the detached pty host.
- Hook-driven notifications (`Notification`/`Stop` hooks) rather than scraping
  terminal output.
- Filtering system ports by default (the *instinct* is right — H1-H4 fix the count
  shown, not the filtering itself).
- The `theme/themes.ts` `build()` derivation, wash-direction handling, and shipped
  `contrast()` function — extend, do not replace.
- Existing keyboard/focus work: tree arrow-navigation, focus traps, visible
  focus-visible rings.
- The closed-schema telemetry (`src/shared/telemetry.ts`) with no free-text field —
  keep it closed when adding any new event.

## House rules that apply to every batch (from CLAUDE.md)

- No `Co-Authored-By`, "Generated with", or any AI attribution in commits or PRs.
- No em dashes in user-facing copy — site, UI strings, docs.
- Verify by driving the running app; do not assume a fix works from reading the diff.
- Main-process changes need a full editor restart to take effect; renderer changes hot
  reload. Batches 7 and 8 touch or need new IPC/main-process code — restart to test.
- `src/shared/ipc.ts` is the IPC contract; both sides import it and a test asserts
  every declared channel has a handler — add a channel there first if a batch needs one.

## Sequencing rationale

Batches 1-2 are pure presentation, no logic — safe warm-ups, big visible jump, good way
to see how the codebase responds before anything riskier. Batch 3 (command registry)
must land before 4/5/6, or each of those wires its own actions and reintroduces the
duplication this audit is trying to remove. Batches 7-8 are last because they're the
only ones needing new main-process services/IPC. Batch 4 is the highest-risk single
batch (rewrites `App.tsx` and `StatusBar.tsx` substantially) — coordinate with anyone
else touching those files before starting it.

Batches 10 and 11 were added after batch 9 to close two zones (K, L) discovered once the
sidebar panels themselves got a close read, rather than just the chrome around them.
Batch 10 covers Explorer, Source Control, and Search together, since they share most of
their defects (icon gaps, native `confirm()`, missing keyboard nav) — and, after a second
read (K8-K14), because they share the deeper problem those defects sit on top of: three
panels built one at a time against no common plan. Batch 10 was rescoped from a defect
sweep into a redesign, and it must run **before** batch 11: its section 1 defines the
panel anatomy every sidebar panel obeys, batch 11's included. Run them the other way and
Agents and Claude get built against no contract and need retrofitting. Batch 11 finishes
Agents and, per an explicit later decision, gives Claude its own rail item instead of
leaving it as a tab inside Agents — a deliberate amendment to batch 4's original C5/A3
call, not a regression. Both depend on batches 1-4 the same way batch 5 onward already
did. Batch 8 also picked up three further Preview polish items (G7-G9) as an addition
to its existing scope rather than a new batch, since Preview already had a batch and
splitting its remaining work into a second one would just reintroduce the
one-job-many-homes problem this audit exists to remove.

Batch 12 was added after batch 11 for a different reason from 10 and 11: it is the first
batch written against a shipped screen rather than against the original code. Batch 7's
Start panel landed, the user looked at it, and the layout was wrong in ways that only
become visible once the thing is real. **Batch 12 supersedes batch 7's Start panel layout
entirely** (batch 7's IPC channel, `recentFiles` work and summary derivation all stand),
so nobody should implement batch 7 section 2's arrangement. It runs after batch 10 because
its row idiom is batch 10's row idiom, and it consumes batch 10's `useListKeyNav` hook and
layout tokens rather than deriving parallel ones. Its second half, dismissal, is unrelated
to layout and is in the same batch only because it was reported at the same time; it is
what produced Law 7. Two open items are deliberately left out of it: the Sessions panel's
own hide control (M13, which needs a decision about whether a bottom-docked panel adopts
batch 10's panel anatomy) and whatever is writing absolute paths into `recentFiles`.
