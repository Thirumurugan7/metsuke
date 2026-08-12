# UI tests

Roadmap item `e2e-tests`. Nothing tests the actual interface today. Every UI bug this
project has had was found by hand, and two shipped because the DOM was checked instead
of the pixels.

## What this is

A visual regression suite: Playwright drives the real built app and compares full
screenshots against committed baseline images. A test fails when the interface changes,
whether or not the DOM says the right thing.

Scope is every part of the UI: the core shell, git, terminals and threads, and the
preview, notifications, themes and onboarding.

## Decisions, and why

**Visual baselines rather than hit-testing.** Chosen deliberately. The usual objection
to visual regression is that baselines drift across machines and CI images; that does
not apply here because the suite is scoped to one local machine and is not going to run
in CI. What it buys is that no interface change can pass unnoticed, including the
clipped, covered and off-screen cases that shipped twice from DOM-only checking.

The cost is real and lands on every UI change: a deliberate design tweak means reviewing
and re-committing the affected images. That review is the point, not an accident.

**Local only, no production changes.** The app is driven exactly as shipped. Nothing in
`src/` gains a test mode, an env var, or a stub seam. This rules out CI, which is
accepted.

**Playwright's Electron driver.** Baseline storage, diff images on failure, declarative
masking, tolerance thresholds, retries and a report all exist already. The alternative
was hand-building that on top of `tools/cdp`, which is several hundred lines of
infrastructure to own for no gain. Masking alone settles it: this UI is full of live
values and every one has to be excluded or the suite fails constantly.

**The built app, not the dev server.** `npm run test:ui` runs `electron-vite build`
first and launches `out/main/index.js`. HMR timestamps and dev-only behaviour would
otherwise leak into baselines.

## Architecture

```
playwright.config.ts          workers: 1, serial, baselines beside specs
tests/ui/
  fixtures.ts                 Electron fixture: launch, profile, window, capture
  helpers/workspace.ts        temp workspace tree and temp git repo
  helpers/stable.ts           mask lists, animation freeze, settle waits
  specs/shell.spec.ts
  specs/git.spec.ts
  specs/terminals.spec.ts
  specs/threads.spec.ts
  specs/preview.spec.ts
  specs/chrome.spec.ts
```

Each file owns one area and can be read on its own. `fixtures.ts` is the only place that
knows how the app is launched; a spec never touches Electron directly.

### The fixture

Provides a launched app, a temp workspace, and a `shot(name)` helper. Responsibilities,
in order:

1. **Isolated profile.** Launch with `--user-data-dir` pointed at a temp directory.
   Verified: the app writes `claude-hooks.json` and `Local Storage` there. This gives
   genuine first-run state every run and means tests cannot clobber the real config,
   which matters because dev and packaged builds already share one and collide.
2. **Fixed geometry.** Through `electronApp.evaluate` in the main process, set the
   window to a fixed size and position. Baselines are meaningless otherwise.
3. **Frontmost before capture.** Also in main: `show()`, `moveTop()`,
   `setAlwaysOnTop(true)`. This is the countermeasure to the known trap that
   `Page.captureScreenshot` hangs when the window is occluded, because the compositor
   stops producing frames. Forcing the window genuinely frontmost keeps frames coming.
4. **Capture timeout.** Every capture is raced against a timeout. If it hangs anyway the
   test fails with a message naming the occlusion trap, rather than wedging the run.
5. **Teardown.** Close the app and remove the temp profile and workspace, so a failed run
   never leaves ptys or directories behind.

Serial with one worker: only one window can hold macOS focus, and ptys and ports are
global to the machine.

### Determinism

Two mechanisms.

**Masking.** Regions whose content is live and cannot be pinned: thread ages, the xterm
viewport, the ports panel and its status-bar count, Claude usage figures, git hashes and
dates, the preview webview, the adaptation wheel, and the welcome screen's system-check
results. Masked regions are painted over before comparison.

The xterm viewport is masked wholesale rather than pinned. A real `claude` session starts
whenever a folder opens and prints a trust prompt and a spinner; none of that is stable
and none of it is what these tests are for. Terminal *behaviour* is asserted separately
through the DOM and the store.

**Freezing.** Injected CSS disables animations, transitions and the caret, so nothing is
captured mid-flight.

### Fixtures

`helpers/workspace.ts` builds a temp directory with a fixed file tree, and a temp git
repo with pinned author and committer dates so the log renders identically every run.
Specs that need a dirty tree or a branch build it explicitly.

## Coverage

Roughly 45-60 baselines. Because the suite must drive the UI to reach each state anyway,
cheap non-visual assertions ride along and cost nothing: that a click lands on the
element it appears to land on, that a commit reaches `git log`, that a worktree exists on
disk. They tell you *why* a baseline moved.

- **shell** file tree expand and collapse, opening and switching tabs, an edit marking a
  tab dirty, save, quick open filtering, search results
- **git** status list, staging and unstaging, a commit landing, branch switching, the
  diff view
- **terminals** tab bar with several sessions, switching, reattach across a renderer
  reload
- **threads** the new-thread sheet in both modes, an instance with its worktree, status
  dots, the close path leaving the branch behind
- **preview** the pane, the element picker, and the explained failure state
- **chrome** each theme applied across the shell, the welcome screen, and the floating
  alert window

## Error handling

- A hung capture fails that test with a message pointing at the occlusion trap.
- A missing baseline is written on first run and committed deliberately, never
  auto-accepted on a later run.
- Updating baselines after an intended change is `npm run test:ui -- --update-snapshots`,
  followed by reviewing the image diff before committing.

## Costs and limits

A full run launches the app six times and starts a real `claude` session each time, so
expect roughly two to four minutes and a dependency on the local `claude` binary being
present.

The suite cannot run in CI, by choice. It says nothing about Windows or Linux rendering.
It will not catch a regression inside a masked region, which is why terminal, ports and
usage behaviour stays covered by unit tests and by the non-visual assertions below rather
than by pixels.

### Assertions are DOM and disk, never the store

`window.__store` is exposed under `import.meta.env.DEV` only, so it does not exist in the
built app these tests drive. Non-visual assertions therefore read the DOM and the real
filesystem: tab elements rather than `terminals`, a worktree directory and `git log`
rather than a thread record. This is the better boundary anyway, because it asserts what
a user can actually observe, and it keeps the tests from depending on internal state that
is free to change.
