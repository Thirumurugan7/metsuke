# Open Claude

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

**React StrictMode double-invokes mount effects.** This has caused three separate leaks:
duplicate terminals, an abandoned pty from a discarded effect, and a killed session on
unmount. Guard re-entrant work and kill anything a cancelled async path created.

**Terminals belong to the app, not the window.** Never kill them on reload. `killAll()`
keeps stream handlers wired; `disposeAll()` is shutdown only.

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

---

## Verifying changes

```bash
npm run dev          # app, with CDP on 9222
npm test             # 62 tests
npm run typecheck    # both projects
npm run dist:dir     # fast packaging smoke test
```

`tools/cdp/` drives the running app; read `tools/cdp/README.md` first, it lists the
traps. Renderer errors are surfaced to the terminal running `npm run dev`, so check
there before opening devtools.

---

## Where things are

- `src/renderer/theme/` seven themes; palettes are CSS variables, but Monaco, xterm and
  the alert window each need their own switch
- `src/renderer/components/ClaudePanel.tsx` usage, model, skills; reads `~/.claude`
- `src/main/services/AutomationService.ts` all CDP over the preview
- `src/main/AlertWindow.ts` the floating alert
- `site/` landing page and the roadmap checklist, static, no build step
- `design/` five layout mockups, imports nothing from `src/`
- `docs/superpowers/specs/` the original design doc

`site/roadmap.js` is the live checklist of what is left, including gaps in work already
done. Update `done` there when something lands.

---

## State as of the last session

Working and verified: editor, git client, multi-terminal with reattach, preview with
element picker and full screen, notifications across four channels, the adaptation
flourish, seven themes, onboarding, the Claude panel.

Not done: nothing is published anywhere. No GitHub repo, no installers built for any
platform, no code signing, no auto-update. The name uses Anthropic's trademark and should
change. There is no LICENSE file despite the README claiming MIT. See the roadmap.

Known open bugs: `preview_scroll` intermittently hangs the bridge; the video decode logs
`Unsupported pixel format` harmlessly on every playback; dev and packaged builds share a
userData directory and clobber each other's control config.
