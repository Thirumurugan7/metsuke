# UI tests

Visual regression over the real built app. Playwright launches `out/main/index.js`
with a throwaway profile, parks the window off screen, and compares masked
screenshots against the baselines in `__screenshots__/`.

26 tests across 8 spec files (smoke, stability, shell, git, terminals, threads,
preview, chrome), backed by 25 committed baseline images.

```bash
npm run test:ui              # build, then run
npm run test:ui -- threads   # one spec
npm run test:ui:update       # re-record baselines after an intended change
```

`npm run test:ui` rebuilds the app first, which is slow. While iterating on a spec,
run `npx playwright test` directly against the last build instead.

## Things that will waste your time

**Look at a baseline before committing it.** `--update-snapshots` will happily
record a bug. An unreviewed baseline is worse than no test. Two baselines were once
generated as solid blocks of mask colour, because the adaptation flourish is a full
viewport overlay and its `.adapt-wheel` is masked wholesale; a capture taken while it
was on screen was entirely mask, so the comparison would have passed forever while
asserting nothing at all. Only a human looking at the images caught it. `shot()` now
throws if any mask covers more than half the viewport, which catches this class of
failure automatically, but that check cannot replace looking at what you record.

**Add a mask, do not raise the tolerance.** If a run drifts, something live is in
shot. Widening `maxDiffPixelRatio` hides real regressions everywhere, not just the
one pixel that moved.

**Never use `force: true` to land a click.** A control that cannot be clicked
normally is exactly the bug this suite exists to catch.

**Presence is not visibility.** `toBeVisible()` passed on a preview toolbar that was
in the DOM inside a zero-width slot, because Playwright's visibility check does not
account for ancestor clipping. The test asserted the wrong state and would have kept
passing. Check what a screen actually shows, not just what is mounted.

**The app fixture is worker scoped.** One Electron app serves the whole run, and
`resetApp()` returns it to first-run state between tests, closing the workspace,
killing every terminal, and clearing storage before the next test reloads. This is
deliberate: every launch is a macOS app activation that steals focus, so the suite
launches once rather than once per test.

**The window is parked off screen and shown inactive.** It sits at a fixed size,
shown once without taking focus, and the app is launched with Chromium
anti-throttling flags so captures keep working even though the window is never
frontmost and never visible on the real desktop.

**Running the suite takes over your machine for a moment, and there is no way around
it.** Launching Electron is a macOS app activation: the dock icon appears, focus leaves
whatever you were typing into, and the icon disappears again when the run ends. The
window itself is invisible, but the activation is not preventable from test code.
`setFocusable(false)` and `app.setActivationPolicy('accessory')` were both tried and
both arrive too late, because the app has already activated by the time any test code
can run, and `src/main/index.ts` shows the window itself on `ready-to-show`. The only
lever is launching less often, which is why the fixture is worker scoped. Run this when
you are not in the middle of something.

**The suite runs serially and cannot run in CI.** It needs a real `claude` binary on
PATH, and one shared app instance means tests cannot be parallelised across workers.

## What these baselines do not cover

Worth knowing before trusting a green run.

**xterm theming.** A theme has to be applied separately to the CSS variables, to Monaco
and to xterm, but `.terminal-body` is masked wholesale in every capture, so no baseline
here can catch the terminal failing to follow a theme. The per-theme baselines prove the
shell and Monaco, not the terminal. The commit that added them claims otherwise; it is
wrong.

**Most syntax colours.** The theme specs open `src/app.ts`, which renders keyword, type,
string and func. Each theme also defines comment, number, variable and operator, and
nothing here renders those, so a theme could ship a broken comment colour and pass.

**The floating alert window**, a separate `BrowserWindow` that only appears on a real
notification, and **the preview element picker**, which drives CDP over the webview where
attaching a second debugger would detach the app's own. Both are deliberate gaps.

**Anything inside the preview.** `.preview-webview` is masked, so these tests assert the
editor's chrome around the preview, never the page loaded into it.
