# Batch 1 — Design tokens and type scale

Closes: J1, J5, C1, D1, B5. Reference: `AUDIT.md` zones J, C, D, B.

Scope: `src/renderer/styles.css`, `src/renderer/theme/themes.ts`,
`src/renderer/theme/apply.ts` only. Pure presentation — no logic changes, no new
components. This is a warm-up batch: safe, high visual impact, good first test of the
workflow.

## 1. Collapse font sizes to a six-step scale

Current state: 13 different font-size values in `styles.css` (9, 9.5, 10, 10.5, 11,
11.5, 12, 12.5, 13, 14, 15, 17, 26px), no defined roles.

Target scale — add these as CSS custom properties in `:root` in `styles.css`, alongside
the existing colour tokens:

```css
--text-micro: 11px;     /* badges, counts, port numbers, rail labels */
--text-small: 12px;     /* status bar, tab labels, secondary metadata */
--text-body: 13px;      /* default for all UI text */
--text-panel: 15px;     /* sidebar headers, section headings */
--text-dialog: 20px;    /* sheet/modal titles */
--text-display: 28px;   /* Welcome heading, future Start panel heading */
```

Then go through every `font-size:` declaration in `styles.css` and remap it to the
nearest role using `var(--text-*)` instead of a literal pixel value:

- 9, 9.5, 10, 10.5px → `var(--text-micro)` (11px)
- 11, 11.5px → `var(--text-small)` (12px)
- 12, 12.5, 13px → `var(--text-body)` (13px)
- 14, 15px → `var(--text-panel)` (15px)
- 17px → `var(--text-dialog)` (20px)
- 26px → `var(--text-display)` (28px)

Do this for every rule, not a sample — grep for `font-size:` in `styles.css` first and
work through the full list so nothing is missed. `.activity-label` (currently 9.5px)
and `.activity-icon` are the ones to check most carefully since they're the smallest
text in the whole app.

## 2. Separate "selected" from "hover" in the interaction tokens

Current problem: `.activity-item.active` uses `--hover-hard` (13% white/black wash) and
plain hover uses `--hover-strong` (10%). Three points of alpha is not a readable
difference between "this is selected" and "your mouse is here."

In `styles.css`:
- Keep `--hover` and `--hover-strong` as they are, for genuine hover-only feedback.
- Add a new token in `:root`: `--selected-bg` — should read clearly against
  `--hover`/`--hover-strong`. A reasonable starting point is a tinted version of
  `--accent` at low opacity (e.g. `rgba(accent, 0.16)` dark / `rgba(accent, 0.10)`
  light) rather than a wash of white/black — check this doesn't clash before locking it
  in.
- Update `.activity-item.active`, `button.active`, and any other `.active`/`.selected`
  selector in `styles.css` to use `--selected-bg` instead of `--hover-hard`.
- Leave `--hover-hard` in place only if something else still legitimately uses it after
  this change — otherwise remove it to avoid a second unused "strong hover" concept.

## 3. Un-uppercase and resize the sidebar header

In `styles.css`, find `.sidebar-header` (currently `text-transform: uppercase`,
`letter-spacing: 0.08em`, 11px, dim colour). Change to:
- `text-transform: none`
- remove the `letter-spacing`
- `font-size: var(--text-panel)` (15px)
- full `var(--fg)` colour, not `--fg-dim`

This affects every sidebar panel's heading (Explorer, Source Control, Search, Ports,
Threads, Claude) since they all render through the same `.sidebar-header` element in
`App.tsx`. Verify visually that all six still fit the header row without wrapping —
"Source Control" was the one that wrapped before at the old size, per the code comment
already in `App.tsx` around the `.activity-label` rule; make sure this change doesn't
reintroduce a wrapping problem in the *sidebar* header (different element, same risk).

## 4. Restrict accent colour to selection state, add supporting tokens

Currently `--accent` is used for: active rail item, badge backgrounds, primary
buttons, and the focus ring. Per J5, this needs to split into distinct tokens so accent
means one thing.

In `theme/themes.ts`, inside the `build()` function's returned `tokens` object, add:

```ts
focus: spec.accent,          // same value as accent for now, but a separate token
badge: spec.dark ? mix(spec.fg, spec.bg, 0.7) : mix(spec.fg, spec.bg, 0.85),
```

(`mix()` already exists in this file — reuse it rather than writing a new helper.)

Then in `styles.css`:
- Any `outline: 2px solid var(--accent)` focus-visible rule → `var(--focus)`.
- `.activity-item .dot`, `.status-count`, and any other pure-count badge currently using
  `var(--accent)` as a background → `var(--badge)`. Keep white/on-accent text only where
  it's still sitting on an actual accent-coloured surface; otherwise use `var(--fg)` on
  the new neutral badge background.
- `button.primary` keeps `var(--accent)` — this is the one place accent legitimately
  doubles as "the thing to do next."

Do not touch `button.primary:hover` (`--accent-hover`) — that's a different, correctly-
scoped token already.

## 5. Do not touch

- Any `.tsx` file in this batch. If a component needs a class name added or removed to
  support the above, note it here and stop rather than editing components — that's
  batch 4's job. (In practice this batch should be achievable with zero `.tsx` edits.)
- The seven theme specs' actual colour values in `themes.ts` (`bg`, `fg`, `accent`,
  etc.) — only the token *names/structure* in `build()` change, not the palette itself.
- `xtermTheme()` in `theme/apply.ts` — leave terminal colours alone, this batch is about
  chrome, not the terminal's own palette.

## Verify

- `npm run typecheck`
- `npm test`
- Launch with `npm run dev`, cycle through all 7 themes via the theme picker (inside
  the notifications dialog for now — batch 9 moves it), confirm text is legible and
  selection/hover are visually distinguishable in every theme, light included.
- `npm run test:ui`, review diff images in `test-results/` before blessing.

## When done

Tick J1, J5, C1, D1, B5 in `PROGRESS.md`. Commit as:
`ux(batch-01): design tokens and type scale`
