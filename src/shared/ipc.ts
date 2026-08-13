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
  /**
   * True for ports that are not somebody's dev server: the editor's own processes, and
   * known daemons that do not serve web pages. Hidden by default — opening one shows a
   * blank pane, which reads as the preview being broken.
   */
  system: boolean
}

export interface TerminalSpawnOptions {
  /** Command to run. Defaults to the user's shell. */
  command?: string
  args?: string[]
  cwd?: string
  cols?: number
  rows?: number
  /** Opaque UI metadata, kept so a reloaded renderer can rebuild the tab. */
  kind?: string
  title?: string
}

export interface TerminalSession {
  id: string
  command: string
  cwd: string
  /** Echoed back from spawn, so tabs survive a reload. */
  kind: string
  title: string
}

/**
 * What merging a thread's branch would do, computed without touching the working tree.
 *
 * `conflictsKnown` is false when git could not answer, on a version without
 * `merge-tree --write-tree`. An empty `conflicts` list then means "unknown", not
 * "clean", and the UI has to say so rather than promise a smooth merge.
 */
export interface MergePreview {
  /** Branch that would receive the work, that is, the currently checked out one. */
  base: string
  branch: string
  /** Commits on `branch` that `base` does not have. */
  commits: number
  /** Paths that would conflict. Empty and `conflictsKnown` means it merges cleanly. */
  conflicts: string[]
  conflictsKnown?: boolean
  /** Already contained in base, so there is nothing to land. */
  alreadyMerged: boolean
  added: number
  removed: number
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * How a thread runs, which is the whole distinction.
 *
 * An `instance` is its own `claude` process with its own pty, its own conversation and,
 * optionally, its own git worktree and branch. A `subagent` runs *inside* an instance,
 * via Claude's own Task tool: it starts from the prompt its parent hands it and returns
 * a summary. Subagents isolate context rather than share it, so their file reads never
 * enter the parent conversation and there is nothing to scroll back to.
 */
export type ThreadMode = 'instance' | 'subagent'

export type ThreadStatus =
  /** Working. */
  | 'running'
  /** Blocked on the user, usually a permission prompt. */
  | 'waiting'
  /** Alive but with nothing to do. */
  | 'idle'
  /** Finished cleanly. */
  | 'done'
  /** Exited non-zero, or its subagent call returned an error. */
  | 'failed'

export interface Thread {
  id: string
  title: string
  mode: ThreadMode
  status: ThreadStatus
  /** Set on subagents: the instance thread that spawned it. */
  parentId: string | null
  /** Instances own a pty. A subagent runs inside its parent's, so this stays null. */
  terminalId: string | null
  cwd: string
  /** Branch it works on, when it has its own worktree. */
  branch: string | null
  /** Absolute path of its worktree, or null when it shares the workspace checkout. */
  worktree: string | null
  /** Claude Code session, learned from the first hook this thread delivers. */
  sessionId: string | null
  /** For subagents, the agent type the Task call asked for. */
  agentType: string | null
  /** The line under the title: "needs permission", "41 files read". */
  detail: string | null
  /** Lines added and removed on this thread's branch, against where it started. */
  added: number
  removed: number
  createdAt: number
  endedAt: number | null
}

export interface NewThreadOptions {
  title: string
  mode: ThreadMode
  /** Give an instance its own worktree and branch, so it cannot touch your files. */
  worktree: boolean
  /** Branch for that worktree. Defaults to a slug of the title. */
  branch?: string
  /** Which instance runs a subagent. Defaults to the most recently active one. */
  parentId?: string
  /** Opening prompt. Typed into the pty for an instance, delegated for a subagent. */
  prompt?: string
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
  /**
   * The adaptation flourish: a faint wheel and a low tone the first time Claude
   * exercises a capability, or when you hand it a definitive instruction.
   */
  adaptation: boolean
  /** Raise and focus the editor window when a modal fires. */
  focusWindow: boolean
  /** Native OS notification centre. */
  system: boolean
  sound: SoundChoice
  telegram: { enabled: boolean; chatId: string; /** Write-only; never read back. */ botToken: string }
  /** Which events notify at all. */
  events: Record<NotifyEvent, boolean>
}

/**
 * A moment worth marking: Claude reached for something it had not used yet, or you
 * pointed it at something new.
 */
export interface Adaptation {
  /** What was adapted to, e.g. a tool name or "project check". */
  skill: string
  /** Epoch milliseconds. */
  at: number
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

/**
 * What the editor found on the machine when it started.
 *
 * The editor runs the real `claude` CLI in its terminal, so a missing binary is the
 * single most likely first-run failure. Detecting it lets the welcome screen say so
 * plainly instead of leaving the user with a terminal that dies without explanation.
 */
export interface SystemCheck {
  claude: { installed: boolean; version: string | null }
  git: { installed: boolean; version: string | null }
  platform: NodeJS.Platform
}

/** Token totals for one model. */
export interface ModelUsage {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** What Claude Code has spent, read from the transcripts it writes locally. */
export interface UsageReport {
  today: ModelUsage[]
  week: ModelUsage[]
  /** Usage for the open folder only, or null when no folder is open. */
  workspace: ModelUsage[] | null
  sessions: number
  windowDays: number
  generatedAt: number
}

/** A skill available to Claude in this project. */
export interface ClaudeSkill {
  name: string
  description: string
  source: 'user' | 'project' | 'plugin'
  plugin?: string
  path: string
}

export interface ClaudeConfig {
  /** From ~/.claude/settings.json. The editor reads this and never writes it. */
  globalModel: string | null
  /** The model the editor passes to sessions it starts. Null follows the global one. */
  sessionModel: string | null
  plugins: string[]
}

/** An element the user picked in the preview with the element picker. */
export interface PickedElement {
  selector: string
  tag: string
  id: string | null
  classes: string[]
  text: string
  html: string
  rect: { x: number; y: number; width: number; height: number }
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

  /** What tooling is present on this machine. Cheap, and cached after the first call. */
  'system:check': { args: []; result: SystemCheck }

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
  /** Buffered output so far, replayed when a reloaded renderer reattaches. */
  'terminal:history': { args: [id: string]; result: string }

  // -- threads --------------------------------------------------------------
  'threads:list': { args: []; result: Thread[] }
  /** Start a thread. Creates a worktree and a pty for an instance; delegates for a subagent. */
  'threads:create': { args: [opts: NewThreadOptions]; result: Thread }
  /**
   * Finish with a thread. Kills its pty and, when `removeWorktree`, deletes the
   * worktree. The branch is always kept: the commits are the point of the thread.
   */
  'threads:close': { args: [id: string, opts: { removeWorktree?: boolean }]; result: void }
  /** Recompute diff stats for every thread that owns a branch. */
  'threads:refresh': { args: []; result: Thread[] }
  /** What landing this thread would do, without doing it. */
  'threads:mergePreview': { args: [id: string]; result: MergePreview }
  /**
   * Merge a thread's branch into the branch the workspace has checked out, then close
   * the thread. The worktree goes; whether the branch goes is the caller's choice.
   */
  'threads:merge': {
    args: [id: string, opts: { message?: string; deleteBranch?: boolean }]
    result: void
  }

  // -- ports ----------------------------------------------------------------
  'ports:list': { args: []; result: PortInfo[] }

  // -- claude ---------------------------------------------------------------
  'claude:usage': { args: []; result: UsageReport }
  'claude:skills': { args: []; result: ClaudeSkill[] }
  'claude:config': { args: []; result: ClaudeConfig }
  /** Set the model for sessions the editor starts. Null follows the global default. */
  'claude:setModel': { args: [model: string | null]; result: void }

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

  // -- floating alert window ------------------------------------------------
  /** The alert page reporting it can receive payloads. */
  'alert:ready': { args: []; result: void }
  'alert:dismiss': { args: []; result: void }
  /** Hide the alert, raise the editor, and focus the Claude session that raised it. */
  'alert:goto': { args: [sessionId: string | null]; result: void }

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
  /** Turn Chromium's element picker on in the preview. */
  'preview:inspectStart': { args: []; result: void }
  'preview:inspectStop': { args: []; result: void }
  /**
   * Send a comment about a picked element to a Claude session, by typing it into that
   * terminal exactly as the user would.
   */
  'preview:comment': {
    args: [sessionId: string, element: PickedElement, comment: string, url: string]
    result: void
  }
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
  /** The whole list, whenever any thread changes. Small enough that diffing is not worth it. */
  'threads:changed': [threads: Thread[]]
  'notify:fired': [payload: NotificationPayload]
  /** Sent to the floating alert window only. */
  'alert:payload': [payload: NotificationPayload]
  /** Main renderer: focus the Claude terminal that asked for attention. */
  'notify:goto': [sessionId: string | null]
  'preview:navigated': [url: string]
  /** The user clicked an element while the picker was active. */
  'preview:elementPicked': [element: PickedElement]
  'preview:console': [message: ConsoleMessage]
  /** Claude exercised a capability for the first time this session. */
  'adapt:fired': [adaptation: Adaptation]
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
  'system:check',
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
  'terminal:history',
  'threads:list',
  'threads:create',
  'threads:close',
  'threads:refresh',
  'threads:mergePreview',
  'threads:merge',
  'ports:list',
  'claude:usage',
  'claude:skills',
  'claude:config',
  'claude:setModel',
  'notify:get',
  'notify:set',
  'notify:test',
  'notify:pickSound',
  'notify:sound',
  'alert:ready',
  'alert:dismiss',
  'alert:goto',
  'preview:register',
  'preview:navigate',
  'preview:reload',
  'preview:console',
  'preview:network',
  'preview:clear',
  'preview:inspectStart',
  'preview:inspectStop',
  'preview:comment'
] as const satisfies readonly InvokeChannel[]

export const EVENT_CHANNELS = [
  'files:changed',
  'git:changed',
  'ports:changed',
  'terminal:data',
  'terminal:exit',
  'threads:changed',
  'preview:navigated',
  'preview:console',
  'preview:elementPicked',
  'notify:fired',
  'alert:payload',
  'notify:goto',
  'adapt:fired',
  'app:error'
] as const satisfies readonly EventChannel[]
