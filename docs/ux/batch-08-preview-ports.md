# Batch 8 — Preview and ports

Closes: G1, G3, G4, G5, G6, C4, H1, H2, H3, H4. Reference: `AUDIT.md` zones G and H in
full, and the "preview and ports" section with the toolbar/ports mock-ups.

Depends on batch 2 (icons), batch 4 (rail no longer has a separate Ports item), batch 6
(the "not attached" copy pattern this batch also applies to ports). Likely needs new
main-process work (port probing) — per `CLAUDE.md`, main-process changes need a full
restart to verify, not just hot reload.

## 1. Promote element-picking to the primary toolbar control (closes G1)

In `Preview.tsx`, the "Select" button is currently a `labelled` button of equal visual
weight to Back/Forward/Reload/Go, positioned between the address bar and the fullscreen
toggle. Per G1, this is the product's strongest differentiator and needs to look like
one.

- Give it visually higher weight than the navigation controls — e.g. styled closer to
  `button.primary` (or a dedicated `.point-at-it` class with similar prominence) rather
  than `button.labelled`.
- Rename the label from "Select" to **"Point at it"** (matches the audit's copy
  recommendation and the language the README itself already uses to describe this
  feature — check `README.md`'s "Point at something and say what is wrong" section for
  the exact phrasing to stay consistent with).
- Add a shortcut, e.g. `⌘⇧A` — register it both as a real keyboard binding and as a
  command in `state/commands.ts` (batch 3's registry) under the `Preview` section, so
  it's reachable from `⌘K` too.
- Add a one-time coach mark: the first time a page successfully loads in the preview
  (the existing `onStop`/`dom-ready` handling in `Preview.tsx` already detects this),
  show a small dismissible callout near this button: "Click any element and tell Claude
  what should change." Persist "seen" state the same way other one-time UI hints are
  persisted in this app if such a mechanism exists — otherwise a simple persisted
  boolean (same persistence mechanism used in batch 7 for recent files) is enough. Only
  show it once per install, not once per page load.
- While `inspecting` is true, dim the rest of the app chrome (a semi-transparent overlay
  over everything except the preview pane and the escape hint) so the mode is
  unmistakable — check `previewFullscreen`'s existing escape-key handling in
  `Preview.tsx` for the pattern to follow for a similar "how do I get out of this mode"
  affordance.

## 2. Fix toolbar details (closes G3, G6)

- Address input placeholder: change `"localhost:3000 — or just a port number"` to
  `"localhost:3000"`. The em dash is also a house-rule violation per `CLAUDE.md` ("No em
  dashes in user-facing copy") independent of the truncation problem — check the rest of
  this file and nearby files for other em dashes while you're in there, since this
  audit found at least one more (`H3`'s "open ↗" isn't an em dash, but worth a quick
  grep of `Preview.tsx` and `PortsPanel.tsx` for `—` specifically).
- Fullscreen exit (G6): confirm the exit control (`⤡`/`Icon name="exitFullscreen"`
  after batch 2) stays in a fixed, predictable position, and add a brief fade-out hint
  on entering fullscreen: "Press Esc to exit." This can be a simple toast-like element
  local to `Preview.tsx`, not the global `Toasts.tsx` system (that's for errors/
  notifications, this is a contextual hint) — a small absolutely-positioned element that
  fades after ~2-3 seconds is enough, respecting `prefers-reduced-motion` for the fade.

## 3. Remove the negative-by-default attachment language (closes G5)

If batch 6 already handled the `Preview.tsx` footer pill (`.cdp-pill`), confirm it's
done: no text when not attached, "Claude can control this page" only when
`previewAttached` is true. If batch 6 hasn't landed yet or skipped this specific piece,
do it now — this is a small, contained change.

## 4. Ports: one home, ranked, probed (closes G4, C4, H1, H2, H3, H4)

**One home (G4):** `PortsPanel` is currently mounted both in the sidebar (via the rail's
`ports` view, if batch 4 hasn't already removed that) and in `Preview.tsx`'s footer via
`<PortsPanel compact />`. After batch 4's rail change, the sidebar mount should already
be gone — confirm it. Ports should render only inside `Preview.tsx`'s footer from this
point on. If the rail entry still exists somehow, remove it as part of this batch.

**Probe before offering (H4):** Add a liveness check for each candidate port before
showing it as loadable. In the main process (wherever ports are currently enumerated —
check `src/main/services/` for the existing port-scanning service), add a lightweight
probe per port: attempt a HEAD request (or minimal GET) and classify the result:
- responds with an HTML content-type → "serves HTML" / likely a dev server
- responds but not HTML, or connection reset/closed → "not a web server"
- refused/timeout → don't show as probe-able at all, or show as "no response"

This needs a new or extended IPC channel if the current `ports:*` channel(s) in
`shared/ipc.ts` don't already return this classification — check the existing shape
first (`PortInfo` or similar type) and extend it rather than adding a parallel channel,
if the existing one is a reasonable place for it. Remember the contract test requiring
every channel to have a handler on both sides.

**Rank by relevance (H2):** Sort the port list: (1) ports started from this app
(`port.ours`, which already exists per the current code), (2) ports that probed as
HTML-serving, (3) everything else, collapsed under the existing "Show N system ports"
affordance (already built, keep that mechanism, just change what counts as "system" —
today it's a simple heuristic; after probing, "system" can mean "did not probe as
HTML-serving" rather than whatever the current heuristic is, which per `H2`'s findings
currently surfaces things like `java` and `figma_agent` as if they were candidates).

**Fix the counts everywhere (C4, H1):** Every place a port count is shown (previously
the rail badge, now removed; the status bar, batch 4 should have removed or updated it;
`PortsPanel.tsx` itself) should count only the "usable"/HTML-serving set, never the raw
total. Grep for `ports.length` across the renderer and check each usage is now counting
the filtered set, not the raw array.

**Fix the verb (H3):** In `PortsPanel.tsx`, the row action currently reads `open ↗`
but loads the URL into the internal preview, not an external browser. Change the
primary label to **"Preview"** (no arrow icon, since it's not external). Add a
*separate*, secondary control with the external-link icon that actually opens the URL
in the user's real browser — check whether an IPC channel for "open external URL"
already exists (Electron's `shell.openExternal` is the standard mechanism; check
`src/main/` for whether this is already wired for any other purpose, e.g. opening docs
links) and reuse/extend that rather than building new main-process code from scratch if
something adjacent already exists.

## Do not touch

- `Explorer.tsx`, `GitPanel.tsx`, `SearchPanel.tsx` — unrelated to this batch.
- The Start panel from batch 7 — this batch only touches Preview's *own* empty state,
  which per batch 7's notes was deliberately left for this batch (the
  package.json-dev-script-detection / listening-port-detection smart empty state
  described in the audit's "preview acts on what it knows" section). Build that here:
  when no port is loaded, check `ports` (already probed per above) for anything
  HTML-serving and offer a single button "Load localhost:PORT"; if none, read the
  workspace's `package.json` (via whatever file-read IPC already exists) for a `dev`
  script and offer "Run npm run dev" as a clickable action that starts it in a new
  session (reuse batch 5's session-creation path, passing the command).

## Verify

- `npm run typecheck && npm test`
- Full app restart (not hot reload) to verify the main-process probing change actually
  took effect, per `CLAUDE.md`'s documented trap.
- `npm run dev`: start a real dev server, confirm it's probed and ranked first, labelled
  "serves HTML"; point at a non-HTTP port (e.g. a database if one is running) and
  confirm it's correctly classified as not-a-web-server rather than offered as
  loadable; confirm "Preview" vs the new external-open control both work as expected;
  confirm the coach mark for "Point at it" appears once and doesn't reappear on
  subsequent loads.
- Confirm every remaining port count in the UI reflects the usable/filtered count, not
  the raw total.
- `npm run test:ui`

## When done

Tick G1, G3, G4, G5, G6, C4, H1, H2, H3, H4 in `PROGRESS.md`. Also mark A8 as fully
closed (batch 7 left it partial pending this batch's smart Preview empty state).
Commit as: `ux(batch-08): preview and ports`
