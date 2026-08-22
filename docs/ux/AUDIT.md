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

## Six laws (every batch must satisfy these)

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
- **F2** (Critical) — The menu mixes session-creation, canned tasks (which are prompts,
  not session types), and a persistent settings checkbox. *Fix:* menu = creation only;
  tasks move to Start panel + palette; checkbox moves to Settings.
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
  unlabelled region in the window. *Fix:* rename "Sessions," give it a header.

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
