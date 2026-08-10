# Open Claude

A VS Code–style desktop editor built around Claude Code. It exists so you can watch
Claude work: the file tree, git diffs, and a live browser preview all update as the
agent edits your project — and Claude can drive that preview itself to test UI flows
end to end.

## Running it

```bash
npm install     # rebuilds node-pty against Electron automatically
npm run dev     # launches the app with hot reload
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`.

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
- **Ports** — every listening port on the machine, with the ones started from the
  built-in terminal flagged and sorted first. Click one to load it in the preview.
- **Preview** — an embedded browser pane pointed at your dev server.
- **Terminals** — real ptys, as many as you want. Tabs along the panel, `＋ New` for
  another Claude session or a plain shell, middle-click or `×` to close, restart in
  place when a process exits. Switching tabs never kills a session.

## Notifications

When Claude wants something — permission to run a tool, or your input after sitting
idle — the editor tells you, through whatever channels you turn on:

| Channel | What it does |
|---|---|
| **Pop-up** | A modal over whatever you are doing, wherever you are in the window. Optionally raises the window over other apps. |
| **System** | Your OS notification centre. On macOS, allow it once under System Settings → Notifications. |
| **Sound** | A built-in chime, or any audio file you pick. Volume adjustable. |
| **Telegram** | A message to your phone. Create a bot with @BotFather, get your chat ID from @userinfobot. |

Configure them from `🔔 Alerts` in the status bar. Each channel has a **Test** button,
because a notification you find out is broken when you miss one is worse than none.

You choose which events notify: permission requests and idle waits are on by default,
"finished a turn" is off because it is noisy.

### How it knows

Not by scraping terminal output. The editor generates a Claude Code settings file with
`Notification` and `Stop` hooks pointing at its own loopback control bridge, and passes
it to the embedded `claude` via `--settings`. Claude Code fires those hooks itself, so
the signal is structured and reliable rather than a guess at what the TUI drew.

The bridge URL and token reach the hooks through the pty's environment, so the token is
never written into the settings file. The Telegram bot token is stored via Electron's
`safeStorage` (encrypted at rest where the OS supports it), is never sent back to the
UI, and the settings panel treats it as write-only.

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

Input is synthesised through CDP rather than JavaScript, so events are trusted and
drive real handlers, focus, and native form behaviour.

```
claude (pty)  →  MCP stdio server  →  loopback bridge  →  Electron main  →  CDP  →  preview
```

### Why that is safe to leave unrestricted

The preview is a dedicated surface, not your browser. It runs in its own session
partition with an empty cookie jar, holds none of your logins, and cannot reach the
editor, the filesystem, or the main process. `webSecurity` is disabled *inside the
preview only*, so dev servers with loose CORS and self-signed certs work without a
fight.

The editor's own renderer stays locked down — `contextIsolation` and `sandbox` on, no
Node — and reaches the filesystem only through the typed IPC contract in
`src/shared/ipc.ts`. The control bridge binds to 127.0.0.1 on an ephemeral port behind
a per-run bearer token.

## Layout

| Path | What lives there |
|---|---|
| `src/main/` | Node side: window, filesystem, git, ptys, watching, ports, CDP |
| `src/main/services/` | One file per capability, each testable against a temp directory |
| `src/main/mcp/` | The MCP server and the loopback bridge to it |
| `src/preload/` | The only door between renderer and main; validates channel names |
| `src/renderer/` | React UI |
| `src/shared/ipc.ts` | The IPC contract, imported by both sides |

Design notes: `docs/superpowers/specs/2026-08-10-claude-code-editor-design.md`.

## Inspecting the editor's own UI

In dev, Open Claude exposes its own window over CDP on port 9222 (override with
`OPEN_CLAUDE_DEBUG_PORT`). That means the same trick the preview pane gives you for
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
