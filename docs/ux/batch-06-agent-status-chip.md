# Batch 6 — Agent status chip

Closes: A6, I3. Reference: `AUDIT.md` zone A (A6), I (I3), and the "agent presence"
section with the four-state chip spec.

Depends on batch 4 (leaves title-bar/status-bar slots for this) and batch 5 (session
state vocabulary). This is the single change that most directly fulfils the product's
own stated premise — "watch the agent work" — since right now nothing in the persistent
chrome shows what the agent is doing.

## 1. What already exists, reuse it

The signal for this chip is not new. Per `README.md`, the editor already generates a
Claude Code settings file with `Notification` and `Stop` hooks pointing at its own
loopback bridge — this is how the floating alert window (`AlertWindow.ts`) and
`notificationLog` in `store.ts` already know when Claude wants attention. Thread
statuses (`running`/`waiting`/`idle`/`done`/`failed` in `ThreadsPanel.tsx`'s
`ThreadStatus` type) are the same underlying signal, applied to threads specifically.

Before writing new detection logic, read:
- `store.ts` — how `notificationLog`, `threads`, and `terminals` are populated
- `ThreadsPanel.tsx` — the existing `DOT` status-to-glyph mapping
- `AlertWindow.ts` (main process) — what triggers the floating alert today

The chip should be a **read model over data that already exists**, not a new detection
pipeline. If something genuinely isn't exposed to the renderer yet, that's worth
flagging rather than building new main-process plumbing inside this batch — note the
gap in `PROGRESS.md`.

## 2. The four states

```
idle       — no session running, or all sessions idle/done
working    — at least one session actively running, none waiting
needs you  — at least one session waiting on input/permission (highest priority state)
stopped    — at least one session exited/failed, none working or needing you
```

Priority order when multiple sessions are in different states: `needs you` > `working`
> `stopped` > `idle`. With multiple sessions in the same non-idle state, show a count:
"2 working" rather than picking one arbitrarily.

Add a derived value in `store.ts` (a plain computed getter or a small selector function,
not necessarily new persisted state) that reduces `terminals`/`threads` into this single
`AgentStatus` shape: `{ state: 'idle'|'working'|'needsYou'|'stopped', count: number,
elapsedMs?: number, detail?: string }`. `elapsedMs` is time since the current state
started (e.g. time since the session began working, or time since it started waiting) —
this is what tells a user "it's thinking" from "it's been stuck for eleven minutes," so
don't skip it even though it's the fiddliest part.

## 3. Build the chip component

Create `src/renderer/components/AgentStatusChip.tsx`:

- Renders the appropriate icon/glyph + label per state (reuse the dot glyph vocabulary
  already established in `ThreadsPanel.tsx`'s `DOT` map for visual consistency — same
  glyphs, new home).
- `working` shows the elapsed time, formatted the same way `ThreadsPanel.tsx`'s `age()`
  helper already does (reuse that function, don't duplicate it — export it from
  wherever it lives if it's currently private to that file).
- `needsYou` is the **only** element in the entire redesigned app permitted to animate
  (per the audit's motion budget) — a slow ~2s pulse on the dot/icon only, not the whole
  chip, and gated behind `prefers-reduced-motion` (fall back to a static state + the
  existing glyph change, no motion).
- Clicking the chip: if one session needs attention, focus/select it (switch to its tab
  in Sessions, or select it in Agents per batch 4's rail merge). If several, open the
  Agents rail view instead of guessing which one the user means.
- Render this component **twice** — once in the title bar's centre slot (added as an
  empty placeholder in batch 4), once in the status bar's centre slot (same placeholder)
  — same component, same props, so they can never drift apart in what they report.

## 4. Remove the old "Claude preview idle" readout (closes I3)

If batch 4 already removed this from `StatusBar.tsx`, confirm it's gone. If it's still
there (batch 4 skipped it, or this batch runs first), remove it now: the
`previewAttached` boolean and its "Claude preview idle"/"Claude preview ready" button in
`StatusBar.tsx`, and the matching pill in `Preview.tsx`'s footer
(`.cdp-pill`/`● Claude can drive this page` / `○ Not attached`).

Per G5 (batch 8's territory, but this specific piece is worth doing now since it's the
same underlying problem as I3): that preview-footer pill should say nothing when the
preview isn't attached, and show one positive line only when it is:
"Claude can control this page." Don't build the full G5 fix here (that's batch 8's
broader pass on `Preview.tsx`), just don't leave the old negative-by-default copy
sitting there once the redundant status-bar version is gone.

## Do not touch

- `AlertWindow.ts` or the hook-generation logic in the main process — this batch reads
  existing renderer-side state, it doesn't change what triggers a notification or how
  the floating alert works. The floating alert and this chip are complementary (alert
  catches you when you're away, chip tells you the moment you look back) — not a
  replacement for one another.
- Thread/session creation flows — batch 5's territory.

## Verify

- `npm run typecheck && npm test`
- `npm run dev`: start a Claude session, observe the chip read "working" with an
  incrementing timer; trigger a permission prompt or idle-wait (or simulate by checking
  what currently drives the floating alert) and confirm the chip switches to "needs
  you" with the pulse; confirm the pulse stops under reduced-motion (test via OS
  accessibility settings or a media-query override in devtools); close/crash a session
  and confirm "stopped."
- Confirm the title-bar and status-bar chips always agree — if one says "working" the
  other should never say "idle."
- `npm run test:ui`

## When done

Tick A6, I3 in `PROGRESS.md`. Commit as: `ux(batch-06): agent status chip`
