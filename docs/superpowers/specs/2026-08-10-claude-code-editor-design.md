# Claude Code Editor — Design

**Date:** 2026-08-10
**Status:** Approved, in implementation

## Purpose

A VS Code–style desktop editor built specifically around Claude Code. It exists so you can
watch Claude work: the file tree, git diffs, and a live browser preview all update as the
agent edits your project. Claude drives the preview itself, so it can test UI flows
end-to-end without leaving the editor.

## Non-goals

- Extension marketplace, settings sync, remote development
- Language servers / IntelliSense beyond what Monaco gives for free
- Being a general-purpose editor for people who are not running Claude Code

## Stack

Electron + React + TypeScript + Monaco, built with `electron-vite`.

Chromium is bundled, so the preview is a real `<webview>` with devtools and CDP. Node in the
main process means `node-pty`, the `git` CLI, and `chokidar` all work directly. Same stack as
VS Code itself.

## Process architecture

| Process | Location | Owns |
|---|---|---|
| **Main** (Node) | `src/main/` | Window lifecycle, native dialogs, filesystem, ptys, git, file watching, port scanning, CDP automation, MCP server |
| **Renderer** (Chromium, sandboxed) | `src/renderer/` | All React UI. No Node access. Talks to main only over IPC. |
| **Preview** (`<webview>`) | isolated partition | The user's app under development |

The renderer never touches the filesystem. Every capability is an explicit typed IPC channel
declared in `src/shared/ipc.ts`, imported by both sides, so main and renderer cannot drift and
the complete list of things the UI may do is one readable file.

## Main-process services

Each is a standalone module with one job, no knowledge of Electron or React, testable by
calling it against a temp directory.

- **`FileService`** — read/write/list/rename/delete. Every path resolved and jailed to the
  open folder root; traversal outside is an error.
- **`GitService`** — wraps the `git` CLI. Status, diffs, stage/unstage, commit, branch list and
  checkout, push/pull, log. Full client.
- **`TerminalService`** — spawns and manages `node-pty` sessions. The default session runs
  `claude` in the open folder.
- **`WatcherService`** — chokidar over the open folder. Emits file-tree and git-status change
  events, debounced, so the UI reflects Claude's edits within ~200ms.
- **`PortService`** — discovers listening TCP ports owned by descendants of the open folder's
  processes; each becomes a clickable entry that loads into the preview.
- **`AutomationService`** — attaches `webContents.debugger` to the preview and exposes CDP.

## Layout

Activity bar (Explorer / Source Control / Search / Ports) → sidebar → editor tab group →
preview + ports column on the right → terminal panel across the bottom. All panels resizable
and collapsible.

## Preview automation

The preview `<webview>` runs in partition `persist:preview` with `webSecurity: false`, so dev
servers with loose CORS and self-signed certs work without fighting the browser.

`AutomationService` calls `webContents.debugger.attach()` and exposes CDP domains: `Page`,
`DOM`, `Input`, `Runtime`, `Network`, `Console`. There are no consent prompts — this is a
dedicated preview surface with an empty cookie jar, not the user's browser.

The editor's own renderer keeps `contextIsolation: true` and `sandbox: true`. The preview is
isolated *so that* automation over it can be unrestricted; a page loaded in the preview cannot
reach the editor, the filesystem, or the user's real browser sessions.

### MCP bridge

The main process runs an MCP server over stdio, launched as `codeeditor-mcp`. On opening a
folder the editor writes `.claude/mcp_preview.json` there and starts the embedded terminal's
`claude` with it, so Claude Code gets these tools natively:

| Tool | Does |
|---|---|
| `preview_navigate` | Load a URL (or a discovered port) |
| `preview_snapshot` | Accessibility-tree snapshot of the page, with element refs |
| `preview_screenshot` | PNG of the viewport or an element |
| `preview_click` / `preview_type` / `preview_press` / `preview_scroll` | Synthesized real input events via CDP `Input` |
| `preview_eval` | Run JS in the page and return the result |
| `preview_console` | Buffered console messages, filterable by regex |
| `preview_network` | Recent requests with status, timing, and failures |
| `preview_wait_for` | Block until a selector appears / text renders / network idles |

This is how "Claude tests the UI end-to-end" actually works: it edits a file, the dev server
hot-reloads, it navigates and clicks through the flow, reads the console, and sees its own
regressions.

## Data flow

1. User opens a folder → main resolves root, starts `WatcherService`, `GitService`, `PortService`
2. Renderer requests the tree and git status over IPC and renders
3. Claude (in the embedded terminal) edits files
4. `WatcherService` fires → main pushes `files:changed` / `git:changed` → UI updates
5. Dev server hot-reloads → preview reflects it; `PortService` announces new ports
6. Claude drives the preview through MCP → CDP → sees the result

## Error handling

- IPC handlers return a `Result<T>` union (`{ ok: true, value }` / `{ ok: false, error }`);
  the renderer never sees a raw throw and renders an inline error instead of a blank panel.
- Git failures surface stderr verbatim in the Source Control panel — no invented messages.
- Path-jail violations, missing binaries, and detached debugger sessions each fail loudly with
  an actionable message.
- A crashed preview or pty is restartable from the UI without reopening the folder.

## Testing

- **Unit** (vitest): each service against a temp directory. `GitService` runs on real repos
  created in `beforeEach`. No Electron required.
- **Contract**: the `ipc.ts` channel map is exhaustively checked so every declared channel has
  a registered handler.
- **E2E** (Playwright + Electron): open a fixture folder, assert the tree renders, edit a file,
  assert the git panel shows it, drive the preview through the MCP tools.
