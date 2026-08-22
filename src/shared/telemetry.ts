/**
 * What the editor is allowed to say about itself.
 *
 * This file is the whole contract, and it is deliberately a closed list. Telemetry in a
 * tool like this is one bad field away from exfiltrating somebody's source code: the app
 * sits on a filesystem, wraps an agent that reads it, and holds a terminal that prints
 * it. So there is no free-text event, no "properties" bag, and no path, prompt, command,
 * URL, repository name or file content anywhere in the types below. If a question cannot
 * be answered by the enumerated events here, the answer is a new enumerated event, not a
 * string field somebody fills in later.
 *
 * The server rejects anything that does not match this shape, so a future mistake in the
 * app cannot quietly widen what gets stored.
 */

/** Bumped when the event shape changes in a way the server has to know about. */
export const TELEMETRY_SCHEMA_VERSION = 1

/** Panels and actions worth counting. Closed set: adding one is a deliberate act. */
export type Feature =
  | 'panel_files'
  | 'panel_git'
  | 'panel_search'
  | 'panel_ports'
  | 'panel_threads'
  | 'panel_claude'
  | 'quick_open'
  | 'command_palette'
  | 'search_replace'
  | 'project_check'
  | 'ui_audit'
  | 'element_picker'
  | 'preview_fullscreen'
  | 'guide_opened'
  | 'settings_opened'
  | 'theme_changed'

/** The preview tools, so it is visible which ones agents actually reach for. */
export type PreviewTool =
  | 'navigate'
  | 'reload'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'press'
  | 'scroll'
  | 'state'
  | 'fill'
  | 'eval'
  | 'console'
  | 'network'
  | 'wait_for'

export type TelemetryEvent =
  /** Once per launch. `firstRun` is the very first launch on this machine. */
  | { name: 'app_launched'; firstRun: boolean; claudeInstalled: boolean; gitInstalled: boolean }
  /** Once per quit, with how long the run lasted. */
  | { name: 'app_closed'; sessionSeconds: number }
  /** A folder was opened. Whether it is a git repo, and nothing else about it. */
  | { name: 'folder_opened'; isGitRepo: boolean }
  | { name: 'feature_used'; feature: Feature; theme?: string }
  | { name: 'terminal_spawned'; kind: 'claude' | 'shell' }
  | { name: 'thread_created'; mode: 'instance' | 'subagent'; worktree: boolean }
  | { name: 'thread_landed'; conflicted: boolean }
  | { name: 'preview_tool_used'; tool: PreviewTool }
  | { name: 'update_state'; status: 'checking' | 'available' | 'ready' | 'error' | 'idle' }
  /**
   * Something went wrong in our own code. `message` and `stack` are scrubbed before they
   * are allowed anywhere near this type: see scrub().
   */
  | { name: 'error'; kind: 'uncaught-exception' | 'unhandled-rejection' | 'renderer-gone' | 'ipc'; errorName: string; message: string; stack?: string }

/** Everything an event is stamped with. None of it identifies a person. */
export interface TelemetryEnvelope {
  schema: number
  /** Random per install, stored in userData. Not a login, not a fingerprint. */
  installId: string
  /** Random per launch, so runs can be counted without following anyone across them. */
  sessionId: string
  appVersion: string
  /** 'darwin' | 'win32' | 'linux' and the arch, for build and packaging decisions. */
  platform: string
  arch: string
  /** Major OS version only: "14" rather than "14.6.1", which is close to unique. */
  osVersion: string
  /** Epoch milliseconds, from the client. The server records its own arrival time too. */
  sentAt: number
  events: Array<TelemetryEvent & { at: number }>
}

/**
 * Strip anything that could identify a machine or a project out of a string.
 *
 * Stack traces are the whole reason this exists. A trace from a user's machine carries
 * absolute paths, and an absolute path carries their account name and the name of
 * whatever they were working on: /Users/jane.doe/clients/acme-secret-thing/src/index.ts
 * tells you who they are, who they work for, and what they are building. None of that is
 * needed to know that a null check is missing on line 40.
 *
 * Home directories become ~, everything under them collapses to its basename, and any
 * remaining absolute path is reduced the same way. Applied to every string that reaches
 * an event, not just the ones expected to contain paths.
 */
export function scrub(input: string, homeDir?: string): string {
  let out = input

  // The user's own home first, since it is the longest and most identifying prefix.
  if (homeDir && homeDir.length > 1) {
    out = out.split(homeDir).join('~')
  }

  // file:// urls first, so the scheme does not survive as a stray "file://…".
  out = out.replace(/file:\/\/+/g, '/')

  /*
   * Every path with a directory in it, reduced to its filename.
   *
   * The one directory kept is the one immediately above the file, and only when it is a
   * name that could only be ours: src, services, renderer and the like. Everything else
   * is a name the user chose, and a name the user chose is the name of their employer or
   * their unreleased product about as often as it is anything else. An allowlist means a
   * directory nobody has thought about is treated as sensitive, which is the right
   * default for this function.
   */
  out = out.replace(/(?:[A-Za-z]:)?[\\/](?:[\w .@~-]+[\\/])+[\w .-]+/g, (match) => {
    const parts = match.split(/[\\/]/).filter(Boolean)
    if (parts.length < 2) return match

    const file = parts[parts.length - 1]
    const parent = parts[parts.length - 2]
    return GENERIC_DIRS.has(parent.toLowerCase()) ? `…/${parent}/${file}` : `…/${file}`
  })

  // Anything that looks like an email or a token is never useful to us.
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(email)')
  out = out.replace(/\b[A-Fa-f0-9]{32,}\b/g, '(hex)')

  return out
}

/**
 * Directory names that carry no information about a person or a project, so the one
 * directly above a file may be kept to make a stack trace readable.
 */
const GENERIC_DIRS = new Set([
  'src', 'out', 'lib', 'dist', 'build', 'main', 'renderer', 'preload', 'shared',
  'services', 'components', 'state', 'theme', 'mcp', 'pty-host', 'a11y', 'tools',
  'node_modules', 'release', 'app.asar', 'resources', 'contents', 'macos'
])

/** Cap on any string that reaches the wire. Long enough to debug, short enough to read. */
const MAX_STRING = 600
const MAX_STACK = 2_000

/**
 * Reject anything that is not exactly one of the events above.
 *
 * The server runs this too. A client that has been tampered with, or a future version of
 * the app with a bug in it, cannot store something the schema does not describe.
 */
export function isValidEvent(value: unknown): value is TelemetryEvent {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  const str = (v: unknown, max = MAX_STRING): boolean =>
    typeof v === 'string' && v.length <= max
  const bool = (v: unknown): boolean => typeof v === 'boolean'

  switch (e['name']) {
    case 'app_launched':
      return bool(e['firstRun']) && bool(e['claudeInstalled']) && bool(e['gitInstalled'])
    case 'app_closed':
      return typeof e['sessionSeconds'] === 'number' && Number.isFinite(e['sessionSeconds'])
    case 'folder_opened':
      return bool(e['isGitRepo'])
    case 'feature_used':
      return str(e['feature'], 40) && (e['theme'] === undefined || str(e['theme'], 40))
    case 'terminal_spawned':
      return e['kind'] === 'claude' || e['kind'] === 'shell'
    case 'thread_created':
      return (e['mode'] === 'instance' || e['mode'] === 'subagent') && bool(e['worktree'])
    case 'thread_landed':
      return bool(e['conflicted'])
    case 'preview_tool_used':
      return str(e['tool'], 40)
    case 'update_state':
      return str(e['status'], 40)
    case 'error':
      return (
        str(e['kind'], 40) &&
        str(e['errorName'], 120) &&
        str(e['message']) &&
        (e['stack'] === undefined || str(e['stack'], MAX_STACK))
      )
    default:
      return false
  }
}

/** Scrub and truncate an event's strings. The only way an event should be built. */
export function sanitiseEvent(event: TelemetryEvent, homeDir?: string): TelemetryEvent {
  if (event.name !== 'error') return event
  return {
    ...event,
    errorName: scrub(event.errorName, homeDir).slice(0, 120),
    message: scrub(event.message, homeDir).slice(0, MAX_STRING),
    stack: event.stack ? scrub(event.stack, homeDir).slice(0, MAX_STACK) : undefined
  }
}
