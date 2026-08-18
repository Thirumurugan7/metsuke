# Metsuke

A VS Code–style desktop editor built around Claude Code. It exists so you can watch
Claude work: the file tree, git diffs, and a live browser preview all update as the
agent edits your project — and Claude can drive that preview itself to test UI flows
end to end.

*Metsuke* (目付) is the kendo term for where you fix your gaze during a fight, and the
title of the officer who watched the daimyo on the shogun's behalf. Both are the job
this editor does.

**Not an Anthropic product.** Metsuke is an independent open-source project, not
affiliated with, endorsed by, or sponsored by Anthropic. Claude and Claude Code are
their trademarks. The editor runs the `claude` CLI you install yourself and bills to
your own account with them.

## Running it

```bash
npm install     # rebuilds node-pty against Electron automatically
npm run dev     # launches the app with hot reload
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`.

## Installing it

Builds for macOS, Windows and Linux come from `npm run dist:{mac,win,linux}` via
electron-builder, producing a `.dmg`, an NSIS `.exe`, and an `.AppImage` plus `.deb`.

**They must be built on the platform they target.** node-pty is a native module
compiled against Electron's headers, so a Mac cannot produce a working Windows or Linux
binary. `.github/workflows/release.yml` runs the three builds on a matrix of runners and
attaches the artifacts to a GitHub Release when you push a `v*` tag:

```bash
npm version minor && git push --follow-tags
```

`npm run dist:dir` builds an unpacked app for the current platform, which is the fast
way to check packaging without waiting for installers.

Builds are unsigned. macOS quarantines a downloaded unsigned app — right-click → Open,
or `xattr -dr com.apple.quarantine "/Applications/Metsuke.app"`. Windows SmartScreen
warns once. The download page says all of this.

The landing page lives in `site/` — see `site/README.md`.

## Keyboard shortcuts

`⌘` on macOS, `Ctrl` elsewhere.

| Shortcut | Does |
|---|---|
| `⌘P` | Go to file (fuzzy) |
| `⌘S` | Save |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle terminal |
| `⌘W` | Close tab |
| `⌘O` | Open folder |
| `⌘⇧E` / `⌘⇧G` / `⌘⇧F` / `⌘⇧P` | Files / Git / Search / Ports |

## What it does

- **Explorer** — open a folder, browse the tree, edit in Monaco with per-tab undo
  history. Right-click for new file/folder, rename, and delete. Files edited on disk by
  Claude refresh in place without losing your cursor.
- **Source control** — full git client: status, staged/unstaged diffs, stage, discard,
  commit, branch switching, push/pull, and history.
- **Ports** — dev servers you can preview, with the ones started from the built-in
  terminal flagged and sorted first. Click one to load it. System daemons, databases,
  and the editor's own ports are filtered out by default (they only ever load a blank
  page); "Show N system ports" reveals them.
- **Preview** — an embedded browser pane pointed at your dev server, with back/forward,
  reload, and an address bar that takes a bare port number. A page that fails to load
  says why rather than showing a blank pane. `⛶` fills the window; Escape comes back.
- **Terminals** — real ptys, as many as you want. Tabs along the panel, `＋ New` for
  another Claude session or a plain shell, middle-click or `×` to close, restart in
  place when a process exits. Switching tabs never kills a session.

  Sessions belong to the machine, not to the window or even to the app. They run in a
  separate host process, so a reload, a renderer crash, and a full restart of the editor
  all reattach to the running ptys and replay their scrollback rather than starting over.
  A `claude` session survives you rebuilding the editor around it. A session ends when
  you close its tab, when you open a different folder, or when you quit.

## Point at something and say what is wrong

Hit **Select** in the preview toolbar and click any element on the page. Chromium's own
inspector crosshair highlights as you hover, so hit-testing is exactly what devtools
does. A comment box opens with the element's selector and text; write what should
change, press `⌘Enter`, and it goes to the Claude terminal as a message with the exact
selector attached:

```
[preview element] #save-btn — text: "Save changes" — on http://localhost:3000.
make this button green and larger
```

Claude does not have to guess which button you meant. Selectors stop at the first `id`
and skip framework-hashed class names (`css-1x2y3z`, `sc-…`), so they stay meaningful
across rebuilds.

## Notifications

When Claude wants something — permission to run a tool, or your input after sitting
idle — the editor tells you, through whatever channels you turn on:

| Channel | What it does |
|---|---|
| **Pop-up** | A floating card above *every* application — your browser, your terminal, a fullscreen app — on whichever display your cursor is on. |
| **System** | Your OS notification centre. On macOS, allow it once under System Settings → Notifications. |
| **Sound** | A built-in chime, or any audio file you pick. Volume adjustable. |
| **Telegram** | A message to your phone. Create a bot with @BotFather, get your chat ID from @userinfobot. |

Configure them from `🔔 Alerts` in the status bar. Each channel has a **Test** button,
because a notification you find out is broken when you miss one is worse than none.

You choose which events notify: permission requests and idle waits are on by default,
"finished a turn" is off because it is noisy.

The pop-up is a separate always-on-top OS window, not a modal inside the editor — a
modal only exists while you are looking at the editor, which is exactly when you least
need telling. It appears without stealing focus, so it never interrupts your typing
(turn on "Take focus" if you want it to). A permission alert stays until you answer it;
idle and finished alerts clear themselves after 20 seconds. "Go to Claude" raises the
editor and selects the session that asked.

### How it knows

Not by scraping terminal output. The editor generates a Claude Code settings file with
`Notification` and `Stop` hooks pointing at its own loopback control bridge, and passes
it to the embedded `claude` via `--settings`. Claude Code fires those hooks itself, so
the signal is structured and reliable rather than a guess at what the TUI drew.

The bridge URL and token reach the hooks through the pty's environment, so the token is
never written into the settings file. The Telegram bot token is stored via Electron's
`safeStorage` (encrypted at rest where the OS supports it), is never sent back to the
UI, and the settings panel treats it as write-only.

## Testing the UI end to end

`⌕ Test UI` in the status bar (or `＋ New → Test UI end to end`) starts a Claude session
that walks the running app systematically: it builds a checklist of every reachable
screen, then for each one records the state, fills every form with realistic values and
submits it, retries with invalid input to check the app actually rejects it, clicks the
controls that do not submit, and checks console errors and failed requests after every
interaction. It reports the screens visited, a pass/fail table of flows, and every
problem with the evidence — and says plainly which parts it could not reach.

The prompt is built around an explicit checklist rather than "go and test it", because
the usual failure is a model that pokes two buttons, declares success, and never reaches
the screen that is broken. Like the project check, it is read-only: it reports what it
would change rather than editing.

## The project check

Opening a folder starts a Claude session that first walks the project end to end and
reports back: it works out how the project runs, starts the dev server, loads the port
in the preview, clicks through the main flows, and checks the console and network after
each step. Then you keep talking to that same session.

The check is **read-only** — it is told not to edit, create, or delete anything, only to
report what it would change. It runs when you deliberately open a folder, not when the
editor restores your last folder at launch, so starting the app does not spend tokens
re-inspecting a project you already know about.

Turn it off under `＋ New → Check project on open`, or run it any time from
`✓ Check project` in the status bar.

## How Claude drives the preview

The preview is a `<webview>` with Chrome DevTools Protocol attached, exposed to Claude
Code as an MCP server that the embedded terminal wires up automatically. Claude gets
`preview_navigate`, `preview_snapshot`, `preview_click`, `preview_type`,
`preview_screenshot`, `preview_console`, `preview_network`, `preview_wait_for`, and
friends as native tools — no configuration, no per-action approval prompts.

Two of them carry the end-to-end testing:

- **`preview_state`** — the whole screen in one call: path, title, headings, every form
  with each field's label, type, current value, required flag and validation state,
  select options, loose inputs, buttons, links, open dialogs, on-screen error and status
  messages, plus console errors and failed requests since the last navigation. Password
  values are reported as `(set)`, never echoed.
- **`preview_fill`** — enter values into many fields at once. Text is typed with real key
  events so controlled React inputs update; checkboxes toggle only when the state must
  change; selects match an option by value, exact text, or substring. Each field reports
  its own result, so one bad selector does not hide the other nineteen.

Input is synthesised through CDP rather than JavaScript, so events are trusted and
drive real handlers, focus, and native form behaviour.

Sessions started by the editor have the Chrome extension tools **denied** — as a
server-level rule in the settings file *and* as explicit `--disallowedTools` entries on
the command line, because a permission rule that fails to match is silently a no-op.
They are also told, via an appended system prompt, to use `preview_*` instead. Otherwise
Claude reaches for the extension out of habit and drives a browser window you are not
looking at, leaving the preview pane empty and its console and network output somewhere
you cannot see. Your own `claude` in a normal terminal is untouched.

```
claude (pty)  →  MCP stdio server  →  loopback bridge  →  Electron main  →  CDP  →  preview
```

### What the preview actually is, and what that means

Read this rather than discover it.

**Claude has full control of whatever page is loaded.** Not a screenshot API: real CDP.
It can read the DOM, run arbitrary JavaScript in the page with `preview_eval`, click and
type as a trusted user, and read the console and network log. Everything it reads can end
up in its context, which means it leaves your machine as part of the conversation. Treat
the preview pane as something you are showing to the model on purpose.

**`webSecurity` is off inside the preview only.** That is what makes a dev server with
loose CORS and a self-signed cert work without a fight, and it also means a page loaded
there can make cross-origin requests a normal browser would block. The pane is for your
own app. It is not a browser to read the web in.

**Its session persists.** The preview runs in an isolated `persist:preview` partition
with its own cookie jar, separate from any browser you use and from the editor itself.
It starts empty, and it stays: if you log into something inside the pane, that session
is still there next time, and Claude can act as you on that site for as long as it
lasts. Nothing else on your machine is exposed by it, but that one thing is.

**The bridge is local, not private.** It binds to 127.0.0.1 on an ephemeral port behind
a per-run bearer token, so nothing off your machine can reach it. The token sits in
`mcp-preview.json` in the app's userData directory, so any process running as you can
read it and drive the preview. That is the same trust boundary as your shell.

**The editor itself is not the preview.** Its renderer keeps `contextIsolation` and
`sandbox` on with no Node, and reaches the filesystem only through the typed IPC contract
in `src/shared/ipc.ts`. Terminals are the real exception, and an obvious one: a terminal
is a shell, and `claude` running in it has whatever permissions you gave it.

### What it sends, and what it never sends

Two things leave your machine on the app's own initiative, both of which you control.

**Update checks** ask GitHub for the latest release on launch and every six hours. That
reveals your IP and your current version to GitHub, which is the cost of an editor that
can update itself. Switch it off in Settings.

**Usage reporting** is off until you answer the question on first run, and both answers
are one click. If you say yes it sends, in batches, over HTTPS:

- launches, how long a run lasted, the app version, your OS and architecture
- whether `claude` and `git` were found on your machine
- which panels and features get used, as counts
- errors and crashes: the error type, message, and stack trace from our own code

It never sends anything you or Claude wrote. No file contents, no prompts, no terminal
output, no file paths, no project or repository names, no URLs, and nothing that
identifies you. That is not a policy, it is the shape of the data: `src/shared/telemetry.ts`
is a closed list of events with no free-text field anywhere in it, and the server rejects
anything that does not match. Strings that could carry a path, an email or a token are
scrubbed before they are queued, so even a queued event on your disk is already safe to
read. There is a test suite for exactly that.

You are identified by a random id generated on your machine. Turning reporting off
deletes it, so turning it back on gives you a new one rather than resuming the old.

Beyond those two: no analytics on the website beyond what your own host logs, no account,
no crash reporting service, and nothing else phoning anywhere. Crashes are written to
`crashes.log` in the app's data directory whether or not reporting is on, and that copy
never leaves unless you send it.

## Licenses

Metsuke is MIT licensed; see `LICENSE`.

It ships 118 third-party packages, MIT, ISC, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0 and Python-2.0, each
reproduced in full in `THIRD-PARTY-LICENSES.md`. That file is generated from the
installed tree rather than written by hand, because a hand-written attribution is a
claim about what shipped that nothing checks:

```bash
npm run licenses         # regenerate
npm run licenses:check   # fail if it is stale
```

It covers both what electron-builder copies into the app and what is compiled into the
renderer at build time. React and Monaco are devDependencies in `package.json`, which is
a statement about who installs them, not about whether their code ships.

## Inspecting the editor's own UI

In dev, Metsuke exposes its own window over CDP on port 9222 (override with
`METSUKE_DEBUG_PORT`). That means the same trick the preview pane gives you for
your project works on the editor itself — you can screenshot it, query its DOM, and
drive it while building. `http://127.0.0.1:9222/json/list` lists the target.

The store is also exposed as `window.__store` in dev, so state can be read directly
(`__store.getState().sidebarWidth`) instead of inferred from pixels.

Two things worth knowing when testing the UI this way:

- **Presence is not visibility.** `querySelector(el).click()` succeeds on an element
  that is clipped, off-screen, or covered — which is exactly how a menu that never
  appeared once passed its test. Check `document.elementFromPoint` at the element's
  centre resolves back to it.
- **Measure coordinates in the same step you use them.** Layout shifts between CDP
  connections, and a drag aimed at a stale position silently hits the panel behind.
