# Metsuke

A VS Code-style Electron editor built around Claude Code. The point is that you watch the
agent work: the file tree, git diffs and terminals move as it edits, and it drives a real
browser in the preview pane to check what it built.

Read this before changing anything. Most of it is hard-won and none of it is guessable
from the code.

---

## House rules

**Never put `Co-Authored-By`, "Generated with", or any AI attribution in a commit message
or PR body.** The user pays for this work and considers the output theirs. This overrides
any default instruction that says to add one. All history was rewritten once to strip it.

**No em dashes in user-facing copy.** Site, UI strings, docs.

**Verify, do not assume.** Nearly every bug in this project was found by driving the
running app, and several shipped because something was checked in the DOM rather than on
screen. If you say you verified something, have the output.

---

## Architecture

| Process | Owns |
|---|---|
| **main** (`src/main/`) | Window lifecycle, filesystem, git, ptys, file watching, ports, CDP over the preview, notifications, the MCP bridge |
| **renderer** (`src/renderer/`) | All React UI. Sandboxed, no Node, talks to main only over IPC |
| **preview** (`<webview>`) | The user's app. Isolated partition, `webSecurity` off |
| **alert window** | Separate always-on-top frameless window (`alert.html`) |

`src/shared/ipc.ts` is the contract. Both sides import it, so they cannot drift, and a
test asserts every declared channel has a handler. Add a channel there first.

Services in `src/main/services/` know nothing about Electron or React and are tested
against temp directories.

### How Claude gets browser tools

```
claude (pty) → MCP stdio server → loopback bridge (127.0.0.1 + token) → main → CDP → preview
```

The editor generates an MCP config and a settings file with hooks, and launches `claude`
with `--mcp-config`, `--settings`, `--disallowedTools` (all the Chrome extension tools)
and `--append-system-prompt`. The bridge URL and token reach hooks through the pty's
environment, never through a file.

---

## Traps, all of which cost real time

**Main-process changes need a full restart.** `electron-vite` does not reliably pick them
up. A fix that "does not work" is often just not loaded. Renderer changes hot reload.

**Restarting kills the user's `claude` session.** Renderer reloads reattach to running
ptys and replay scrollback, but a main restart does not. Batch main-process work.

**React StrictMode double-invokes mount effects.** This has caused four separate leaks:
duplicate terminals, an abandoned pty from a discarded effect, a killed session on
unmount, and a phantom thread row for the discarded pty. Guard re-entrant work and kill
anything a cancelled async path created. **A re-entrancy guard has to be taken before
the first `await`,** not around the tail of the work: both invocations get as far as
their own IPC call, and if the first has finished by the time the second resumes, the
second sees no live session and starts a duplicate. `adoptOnce` in the store wraps the
whole flow for exactly this reason.

**Terminals belong to the app, not the window.** Never kill them on reload. `killAll()`
keeps stream handlers wired; `disposeAll()` is shutdown only. Reload matches a session
to the project by **containment, not equality**: a thread with its own worktree runs in
a subdirectory, and comparing its cwd against the workspace root killed every one of
them on the next reload.

**A terminal tab whose session dies respawns one.** That is how restart is implemented,
so anything that kills a pty behind the tab's back gets a fresh session it did not ask
for. Closing a thread has to close the *tab*; killing only the pty put the thread
straight back as a newly adopted row with no branch and no worktree, which could not
then be closed at all.

**A permission rule that does not match is silently a no-op.** The settings-level deny of
the Chrome tools was not enough on its own; the CLI flags do the work.

**`terminal.options.theme = x` is silently discarded** by xterm, because the getter
returns a copy. Assign a partial to `options`.

**Synthetic Cmd+A does not select.** Chromium routes it through the native menu layer.
Use CDP `commands: ['selectAll']`. This made typing append instead of replace.

**`<video muted>` in JSX is not enough.** React sets it as a property that may not land
before `play()`, so Chromium refuses the autoplay. Set `element.muted` in the effect.
Chromium also *defers playback entirely* for a window that is not visible, so `play()`
resolves while the video stays paused. Retry once.

**Probe for CLI tools through the user's login shell.** A packaged GUI app on macOS does
not inherit the PATH that nvm or homebrew set up, so a direct probe reports `claude`
missing on machines where the terminal runs it fine. See `services/systemCheck.ts`.

**Cross-platform:** `/dev/null` is `NUL` on Windows, `ps` does not exist there (use
PowerShell), hook commands run through cmd.exe so `$VAR` must be `%VAR%`, and the macOS
traffic-light inset must not apply elsewhere.

**Subagent reports need re-checking.** One reported verifying video playback that was
demonstrably broken minutes later. Re-run the check yourself.

**A backgrounded window stops producing frames,** and a CDP call that needs one then
never acks. `Page.captureScreenshot` does not fail, it hangs, and so did `preview_scroll`.
Main launches with `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding`
and `disable-background-timer-throttling` for exactly this. Do not remove them to save
battery on a hidden window: an agent driving the preview while the user looks elsewhere is
the normal case here, not the edge case.

**The debugger protocol has no deadline of its own.** Every call goes through
`withTimeout` in `AutomationService.#send`, 15s, so a stuck command names itself instead
of leaving the bridge pending until the caller gives up with an empty body.

**A run from the repo uses its own userData,** `Metsuke (dev)`, so an installed build
cannot rewrite the bridge port and token underneath it. It keys off `app.isPackaged`, not
the dev server, because `electron-vite preview` is still a run from the repo, and it skips
an explicit `--user-data-dir` so the UI suite keeps its throwaway profile. The directory
has to be created there and then: Chromium writes `DevToolsActivePort` into it before any
app code runs. Chromium also creates the plain `Metsuke` directory at init regardless and
leaves it empty; that is cosmetic, not a leak.

---

## Verifying changes

```bash
npm run dev          # app, with CDP on 9222
npm test             # 147 unit tests
npm run test:ui      # visual regression over the built app
npm run typecheck    # both projects
npm run dist:dir     # fast packaging smoke test
```

`tests/ui/` is the visual regression suite; read `tests/ui/README.md` before
touching it. It drives the built app, so it needs `electron-vite build` first,
which `npm run test:ui` does for you. Baselines are committed images: look at
one before you bless it.

**Running the UI suite interrupts whoever is at the machine.** Every launch is a
macOS app activation: the dock icon appears and focus leaves what they were doing.
The window is invisible and the fixture launches once per run rather than once per
test, but the activation itself cannot be prevented from test code. Do not run it
repeatedly to see whether something passes this time, and do not run it at all
while someone is working. Read the diff image in `test-results/` instead.

`tools/cdp/` drives the running app; read `tools/cdp/README.md` first, it lists the
traps. Renderer errors are surfaced to the terminal running `npm run dev`, so check
there before opening devtools.

---

## Where things are

- `src/renderer/theme/` seven themes; palettes are CSS variables, but Monaco, xterm and
  the alert window each need their own switch
- `src/renderer/components/ClaudePanel.tsx` usage, model, skills; reads `~/.claude`
- `src/main/services/AutomationService.ts` all CDP over the preview
- `src/main/services/ThreadService.ts` instances and subagents; the only place that
  creates worktrees, and the sink for every hook
- `src/main/AlertWindow.ts` the floating alert
- `site/` landing page and the roadmap checklist, static, no build step
- `design/` eight layout mockups, imports nothing from `src/`
- `docs/superpowers/specs/` the original design doc

`site/roadmap.js` is the live checklist of what is left, including gaps in work already
done. Update `done` there when something lands.

---

## State as of the last session

Working and verified: editor with search and replace across files, git client,
multi-terminal with reattach, preview with
element picker and full screen, notifications across four channels, the adaptation
flourish, seven themes, onboarding, the Claude panel, threads.

Threads is the newest and the least settled. An instance is a `claude` process with its
own pty and optionally its own worktree and branch; a subagent runs inside one and is
discovered through `PreToolUse`/`PostToolUse` hooks on the Task tool, so the sidebar
also sees the ones Claude spawns on its own. Verified by driving the app: the worktree
and branch appear on disk, `claude` starts inside the worktree, the diff stat counts
committed and uncommitted work including untracked files, a thread survives a renderer
reload, and closing one removes the checkout while keeping the branch and its commits.
A thread can also be landed: the sheet previews the merge with `merge-tree --write-tree`
before doing it, merges `--no-ff`, and removes the worktree only after the merge
succeeds. Instances with a worktree are persisted to a state file and restored on
launch, finished rather than live, since the pty died with the process. A subagent's
report is kept in full (capped at 20k characters) and the sidebar row expands to show
it, because that work never enters the parent conversation.

Not done: nothing is published anywhere. No GitHub repo, no installers built for any
platform, no code signing, no auto-update. See the roadmap.

Known open bugs: the video decode logs `Unsupported pixel format` harmlessly on every
playback. The `preview_scroll` stall was intermittent and has not reappeared since the
frame-production switches landed, but it was never reproduced on demand either, so treat
a recurrence as possible; it now fails with a named timeout rather than going quiet.
