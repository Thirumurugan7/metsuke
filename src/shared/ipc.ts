/**
 * The single source of truth for everything the renderer is allowed to ask the main
 * process to do. Both sides import this file, so the two cannot drift apart, and the
 * complete capability surface of the UI is readable in one place.
 *
 * Invoke channels are request/response. Event channels are main -> renderer pushes.
 */

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Every invoke handler returns this. The renderer never sees a raw throw. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = (error: string): Result<never> => ({ ok: false, error })

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface DirEntry {
  /** Path relative to the workspace root, POSIX separators. */
  path: string
  name: string
  isDirectory: boolean
}

export interface Workspace {
  /** Absolute path of the opened folder. */
  root: string
  name: string
  isGitRepo: boolean
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'unchanged'

export interface GitFileChange {
  /** Path relative to the repo root. */
  path: string
  /** Previous path, for renames and copies. */
  origPath?: string
  /** Status of the staged (index vs HEAD) side. */
  staged: GitFileStatus
  /** Status of the unstaged (worktree vs index) side. */
  unstaged: GitFileStatus
}

export interface GitStatus {
  branch: string | null
  /** True when HEAD is detached. */
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileChange[]
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  upstream: string | null
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  /** ISO-8601. */
  date: string
}

/** Which pair of trees a diff compares. */
export type DiffKind = 'worktree' | 'staged' | 'head'

export interface GitDiff {
  path: string
  kind: DiffKind
  /** Unified diff text, empty when there is no change. */
  patch: string
  /** True when git reports the blob as binary. */
  binary: boolean
}

export interface PortInfo {
  port: number
  /** Best-effort process name, e.g. "node", "vite". */
  process: string | null
  pid: number | null
  /** True when the listening process is a descendant of a terminal we spawned. */
  ours: boolean
}

export interface TerminalSpawnOptions {
  /** Command to run. Defaults to the user's shell. */
  command?: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
}

export interface TerminalSession {
  id: string
  command: string
  cwd: string
}

/** What Claude was doing when it asked for attention. */
export type NotifyEvent =
  /** Claude is asking to run a tool and needs approval. */
  | 'permission'
  /** Claude has been waiting on you with nothing to do. */
  | 'idle'
  /** Claude finished its turn. */
  | 'finished'

export interface SoundChoice {
  enabled: boolean
  /** Absolute path to a user-chosen audio file; null uses the built-in chime. */
  path: string | null
  /** 0–1. */
  volume: number
}

export interface NotificationSettings {
  /** In-app modal over whatever you are doing. */
  modal: boolean
  /** Raise and focus the editor window when a modal fires. */
  focusWindow: boolean
  /** Native OS notification centre. */
  system: boolean
  sound: SoundChoice
  telegram: { enabled: boolean; chatId: string; /** Write-only; never read back. */ botToken: string }
  /** Which events notify at all. */
  events: Record<NotifyEvent, boolean>
}

export interface NotificationPayload {
  event: NotifyEvent
  title: string
  message: string
  /** Claude Code session that raised it, when known. */
  sessionId: string | null
  /** Epoch milliseconds. */
  timestamp: number
}

export interface ConsoleMessage {
  level: 'log' | 'debug' | 'info' | 'warning' | 'error'
  text: string
  url: string | null
  line: number | null
  /** Epoch milliseconds. */
  timestamp: number
}

export interface NetworkRequest {
  requestId: string
  url: string
  method: string
  status: number | null
  statusText: string | null
  /** Milliseconds, null while still in flight. */
  duration: number | null
  failed: boolean
  errorText: string | null
  timestamp: number
}

// ---------------------------------------------------------------------------
// Invoke channels: renderer -> main, with a response
// ---------------------------------------------------------------------------

export interface InvokeChannels {
  // -- workspace ------------------------------------------------------------
  /** Show the native folder picker. Resolves to null when the user cancels. */
  'workspace:open': { args: []; result: Workspace | null }
  /** Open a specific absolute path without a dialog. */
  'workspace:openPath': { args: [root: string]; result: Workspace }
  'workspace:current': { args: []; result: Workspace | null }
  'workspace:close': { args: []; result: void }

  // -- files ----------------------------------------------------------------
  /** One level of the tree. `dir` is relative to the workspace root; '' is the root. */
  'files:list': { args: [dir: string]; result: DirEntry[] }
  /** Every file path in the workspace, for quick-open. */
  'files:all': { args: []; result: string[] }
  'files:read': { args: [path: string]; result: string }
  'files:write': { args: [path: string, contents: string]; result: void }
  'files:create': { args: [path: string, isDirectory: boolean]; result: void }
  'files:rename': { args: [from: string, to: string]; result: void }
  'files:delete': { args: [path: string]; result: void }
  /** Recursive content search. Returns at most `limit` matches. */
  'files:search': {
    args: [query: string, opts: { regex?: boolean; caseSensitive?: boolean; limit?: number }]
    result: Array<{ path: string; line: number; text: string }>
  }

  // -- git ------------------------------------------------------------------
  'git:status': { args: []; result: GitStatus }
  'git:diff': { args: [path: string, kind: DiffKind]; result: GitDiff }
  'git:stage': { args: [paths: string[]]; result: void }
  'git:unstage': { args: [paths: string[]]; result: void }
  'git:discard': { args: [paths: string[]]; result: void }
  'git:commit': { args: [message: string, opts: { amend?: boolean }]; result: string }
  'git:branches': { args: []; result: GitBranch[] }
  'git:checkout': { args: [branch: string, opts: { create?: boolean }]; result: void }
  'git:push': { args: [opts: { setUpstream?: boolean }]; result: string }
  'git:pull': { args: [opts: { rebase?: boolean }]; result: string }
  'git:log': { args: [opts: { limit?: number; path?: string }]; result: GitLogEntry[] }

  // -- terminal -------------------------------------------------------------
  'terminal:spawn': { args: [opts: TerminalSpawnOptions]; result: TerminalSession }
  'terminal:write': { args: [id: string, data: string]; result: void }
  'terminal:resize': { args: [id: string, cols: number, rows: number]; result: void }
  'terminal:kill': { args: [id: string]; result: void }
  'terminal:list': { args: []; result: TerminalSession[] }

  // -- ports ----------------------------------------------------------------
  'ports:list': { args: []; result: PortInfo[] }

  // -- notifications --------------------------------------------------------
  /** Telegram bot token is redacted; `telegramConfigured` says whether one is stored. */
  'notify:get': { args: []; result: NotificationSettings & { telegramConfigured: boolean } }
  'notify:set': { args: [settings: Partial<NotificationSettings>]; result: void }
  /** Fire a sample notification through one channel, to check it is wired up. */
  'notify:test': { args: [channel: 'modal' | 'system' | 'sound' | 'telegram']; result: string }
  /** Native file picker for a custom alert sound. Null when cancelled. */
  'notify:pickSound': { args: []; result: string | null }
  /** The configured sound as base64, so the renderer can play it under a strict CSP. */
  'notify:sound': { args: []; result: { mimeType: string; base64: string } | null }

  // -- preview automation ---------------------------------------------------
  /**
   * Hand the main process the webContents id of the preview <webview> so
   * AutomationService can attach its debugger. Called once when the preview mounts.
   */
  'preview:register': { args: [webContentsId: number]; result: void }
  'preview:navigate': { args: [url: string]; result: void }
  'preview:reload': { args: []; result: void }
  'preview:console': { args: [opts: { pattern?: string; limit?: number }]; result: ConsoleMessage[] }
  'preview:network': { args: [opts: { limit?: number }]; result: NetworkRequest[] }
  'preview:clear': { args: []; result: void }
}

// ---------------------------------------------------------------------------
// Event channels: main -> renderer, fire and forget
// ---------------------------------------------------------------------------

export interface EventChannels {
  /** Paths (workspace-relative) that were created, changed, or removed. */
  'files:changed': [paths: string[]]
  'git:changed': [status: GitStatus]
  'ports:changed': [ports: PortInfo[]]
  'terminal:data': [id: string, data: string]
  'terminal:exit': [id: string, exitCode: number]
  'notify:fired': [payload: NotificationPayload]
  'preview:navigated': [url: string]
  'preview:console': [message: ConsoleMessage]
  /** A background operation failed with no invoke to attach the error to. */
  'app:error': [message: string]
}

export type InvokeChannel = keyof InvokeChannels
export type EventChannel = keyof EventChannels

/**
 * Runtime list of every invoke channel. The contract test asserts that main
 * registers a handler for each one, so a channel can never be declared and forgotten.
 */
export const INVOKE_CHANNELS = [
  'workspace:open',
  'workspace:openPath',
  'workspace:current',
  'workspace:close',
  'files:list',
  'files:all',
  'files:read',
  'files:write',
  'files:create',
  'files:rename',
  'files:delete',
  'files:search',
  'git:status',
  'git:diff',
  'git:stage',
  'git:unstage',
  'git:discard',
  'git:commit',
  'git:branches',
  'git:checkout',
  'git:push',
  'git:pull',
  'git:log',
  'terminal:spawn',
  'terminal:write',
  'terminal:resize',
  'terminal:kill',
  'terminal:list',
  'ports:list',
  'notify:get',
  'notify:set',
  'notify:test',
  'notify:pickSound',
  'notify:sound',
  'preview:register',
  'preview:navigate',
  'preview:reload',
  'preview:console',
  'preview:network',
  'preview:clear'
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'files:changed',
  'git:changed',
  'ports:changed',
  'terminal:data',
  'terminal:exit',
  'preview:navigated',
  'preview:console',
  'notify:fired',
  'app:error'
] as const satisfies readonly EventChannel[]
