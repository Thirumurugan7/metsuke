import { create } from 'zustand'
import { playAlertSound } from './alertSound'
import type {
  DirEntry,
  GitStatus,
  NotificationPayload,
  NotificationSettings,
  InvokeChannel,
  InvokeChannels,
  Adaptation,
  PickedElement,
  PortInfo,
  SystemCheck,
  Thread,
  ThreadMode,
  ThreadStatus,
  NewThreadOptions,
  MergePreview,
  UpdateState,
  Workspace
} from '@shared/ipc'
import type { Feature } from '@shared/telemetry'

/**
 * Unwrap an IPC Result, surfacing the error through the store's banner rather than
 * throwing into a render. Returns null on failure so callers can bail quietly.
 */
export async function call<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeChannels[C]['args']
): Promise<InvokeChannels[C]['result'] | null> {
  const result = await window.api.invoke(channel, ...args)
  if (result.ok) return result.value
  useStore.getState().setError(result.error)
  return null
}

const LAST_FOLDER_KEY = 'metsuke.lastFolder'

/**
 * Adopt a freshly opened workspace: clear everything scoped to the previous folder,
 * then load the root and git status. Shared by the picker and the startup restore.
 */
/**
 * Run one folder-opening flow, start to finish, and refuse to start a second.
 *
 * The guard has to be taken before the *first* await, which is why this wraps the whole
 * flow rather than just the adoption at the end of it. Both StrictMode invocations
 * resolve their own IPC call first, and if the earlier one has finished by the time the
 * later resumes, the later sees no live session yet and spawns a second Claude beside
 * it. Guarding only the tail left exactly that race, and it showed up as a stray
 * "claude 2" tab on roughly every other launch.
 */
async function adoptOnce(open: () => Promise<Workspace | null>, check: boolean): Promise<void> {
  if (adopting) return
  adopting = true
  try {
    const workspace = await open()
    if (workspace) await adoptInner(workspace, { check })
  } finally {
    adopting = false
  }
}

/**
 * Whether a session's working directory is part of the open project.
 *
 * Equality is not enough: a thread with its own worktree runs in a subdirectory of the
 * project, so comparing against the root exactly marked every one of them as belonging
 * to some other folder and killed it on the next reload — taking a running agent with
 * it. Anything genuinely outside the root still gets cleaned up.
 */
function belongsTo(cwd: string, root: string): boolean {
  if (cwd === root) return true
  // Both separators, because the renderer has no path module and Windows uses '\'.
  return cwd.startsWith(`${root}/`) || cwd.startsWith(`${root}\\`)
}

async function adoptInner(workspace: Workspace, opts: { check: boolean }): Promise<void> {
  localStorage.setItem(LAST_FOLDER_KEY, workspace.root)

  /*
   * Sessions live in the main process and outlive this renderer, so after a reload
   * there may already be terminals running for this folder. Reattach to them rather
   * than killing and respawning — a `claude` session must not die because a window
   * reloaded. Sessions belonging to a folder we are no longer showing are killed here,
   * which is also what stops them accumulating.
   */
  const live = (await call('terminal:list')) ?? []
  const mine = live.filter((s) => belongsTo(s.cwd, workspace.root))
  for (const stale of live.filter((s) => !belongsTo(s.cwd, workspace.root))) {
    void call('terminal:kill', stale.id)
  }

  useStore.setState({
    workspace,
    tree: {},
    expanded: new Set(),
    openFiles: [],
    activePath: null,
    recentFiles: loadRecentFiles(workspace.root),
    dirty: new Set(),
    externalEdit: null,
    git: null,
    diffPath: null,
    terminals: [],
    activeTerminal: null
  })

  await useStore.getState().loadDir('')
  await useStore.getState().refreshGit()

  // Reattach to whatever survived, keeping tab order and titles.
  if (mine.length > 0) {
    useStore.setState({
      terminals: mine.map((s) => ({
        id: nextTerminalId(),
        kind: s.kind === 'claude' ? 'claude' : 'shell',
        title: s.title,
        sessionId: s.id,
        exitCode: null
      })),
      activeTerminal: null
    })
    useStore.setState((state) => ({ activeTerminal: state.terminals[0]?.id ?? null }))
    return
  }

  // Opening a folder starts a Claude session. When you opened it deliberately and
  // auto-check is on, that session begins by walking the project end to end and
  // reporting back; either way you can keep talking to it afterwards.
  //
  // Restoring the last folder at launch deliberately skips the check: it is not an
  // action you just took, and re-running a full inspection on every app start would
  // cost real tokens for no new information. "Run project check" is one click away.
  const { autoCheck, addTerminal } = useStore.getState()
  addTerminal('claude', opts.check && autoCheck ? { prompt: PROJECT_CHECK_PROMPT } : {})
}

export type SidebarView = 'explorer' | 'git' | 'search' | 'agents' | 'claude'

export type TerminalKind = 'claude' | 'shell'

export interface TerminalTab {
  /** Stable local id, kept across a restart of the underlying process. */
  id: string
  kind: TerminalKind
  title: string
  /** Backend pty id; null before the first spawn and after the process exits. */
  sessionId: string | null
  exitCode: number | null
  /** Initial message handed to `claude` when the session starts. */
  prompt?: string
  /** For a 'shell' tab only: run this instead of the user's default shell. */
  command?: string
  args?: string[]
}

/**
 * What the editor asks Claude to do the moment you open a folder.
 *
 * Deliberately read-only: this runs unattended, so it inspects and reports rather than
 * editing. Anything it wants to change, it proposes and you approve in the same session.
 */
export const PROJECT_CHECK_PROMPT = `You have just been opened in this folder by the Metsuke editor. Do an end-to-end check of the project and report what you find.

1. Work out what this project is and how it runs — package.json scripts, Makefile, README, whatever applies.
2. Start its dev server in the background if it has one.
3. Once a port is listening, load it with preview_navigate.
4. Use preview_snapshot to find the interactive elements, then walk the main user flows with preview_click and preview_type — navigation, forms, sign-in, whatever this app actually has.
5. After each step, check preview_console and preview_network for errors and failed requests.
6. Report back: what you ran, which flows worked, and every broken or suspicious thing you found, quoting the console or network evidence.

Do not edit, create, or delete any files during this check — inspect only, and tell me what you would change instead.`

/**
 * A systematic end-to-end walk of the running UI.
 *
 * Structured as an explicit loop with a written map, because the failure mode of "test
 * the UI" is a model that pokes the first two buttons, declares success, and never
 * reaches the screen that is actually broken. Keeping a checklist of screens and only
 * finishing when it is empty is what makes the coverage real.
 *
 * Read-only with respect to the codebase: it reports, it does not edit.
 */
export const UI_AUDIT_PROMPT = `Test this project's UI end to end through the editor's preview pane, then give me a written report. Use only the preview_* tools.

Setup
- Work out how to run the project and start its dev server if it is not already up.
- preview_navigate to it, then preview_state to see where you landed.

Build a map
- From preview_state, list every screen you can reach: links, nav items, buttons that open dialogs, and routes you can infer from the router config in the source.
- Keep this list as an explicit checklist. Add to it whenever you discover a screen you had not seen. You are not finished until every entry is visited.

For each screen
1. preview_state — record the path, title, headings, and what is on it.
2. Note every form and control, and what state it starts in.
3. Exercise the flows:
   - Fill each form with realistic valid values using preview_fill, submit it, then preview_state again to see what changed — a new screen, a success message, or nothing at all.
   - Then test it with invalid input: empty required fields, a malformed email, an out-of-range number, an over-long string. Confirm the app rejects them and says why. Silent acceptance of bad input is a bug worth reporting.
   - Click the buttons that do not submit — toggles, tabs, dialogs, menus. Confirm each visibly does something, and close what you open.
4. After every interaction check preview_state's consoleErrors and failedRequests.
5. Use preview_wait_for after anything asynchronous rather than assuming it finished.
6. Take a preview_screenshot of anything that looks visually wrong.

Watch for
- Buttons and links that do nothing.
- Forms that accept invalid input, or reject valid input.
- Errors thrown to the console during normal use.
- Requests returning 4xx or 5xx during a flow that should succeed.
- Dead ends: screens with no way back.
- Controls with no accessible name, which are also unusable by keyboard.

Report
Give me: the list of screens visited, a table of flows tested with pass/fail, then every problem found — what you did, what you expected, what happened, and the console or network evidence. Say plainly which parts of the app you could not reach and why.

Do not edit, create, or delete any files. This is an inspection: tell me what you would change instead.`

const AUTO_CHECK_KEY = 'metsuke.autoCheck'
const PORTS_COLLAPSED_KEY = 'metsuke.previewPortsCollapsed'

const GIT_SECTIONS_KEY = 'metsuke.gitSectionsCollapsed'
/** History starts collapsed: it is reference material, not work in progress, and it is
 *  the longest section by far. Staged and Changes start open. */
// 'staged' is deliberately absent: with nothing stored yet it falls back to "collapsed
// when empty" at the call site, rather than to a fixed true/false here.
const GIT_SECTIONS_DEFAULT: Record<string, boolean> = { changes: false, history: true }

function loadGitSectionsCollapsed(): Record<string, boolean> {
  try {
    return { ...GIT_SECTIONS_DEFAULT, ...JSON.parse(localStorage.getItem(GIT_SECTIONS_KEY) ?? '{}') }
  } catch {
    return { ...GIT_SECTIONS_DEFAULT }
  }
}

/** Minimum quiet period between flourishes, so a burst of new tools plays once. */
const ADAPT_GAP_MS = 12_000
let lastAdaptAt = 0

let terminalSeq = 0
const nextTerminalId = (): string => `t${++terminalSeq}`

const KIND_LABEL: Record<TerminalKind, string> = { claude: 'Claude', shell: 'Shell' }

const TAB_TITLE_MAX = 24

/** First several words of an opening prompt, so a tab reads as what it is doing. Cuts
 *  on a word boundary near the limit rather than mid-word — a tab strip is narrow
 *  enough that a chopped word reads as broken, not just short. */
function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= TAB_TITLE_MAX) return oneLine
  const cut = oneLine.slice(0, TAB_TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  // No space in range at all (one long word) — fall back to the hard cut rather than
  // returning nothing.
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// ── agent status chip ─────────────────────────────────────────────────────────

/** The four states the whole app's agent activity reduces to, in priority order when
 *  more than one applies. */
export type AgentChipState = 'needsYou' | 'working' | 'stopped' | 'idle'
const CHIP_PRIORITY: AgentChipState[] = ['needsYou', 'working', 'stopped', 'idle']

export interface AgentStatus {
  state: AgentChipState
  count: number
  /** How long the reported state has held — the longest-running member when several
   *  sessions share it, so "working" can tell a fresh call from a stuck one. */
  elapsedMs?: number
  /** Set only when exactly one session is behind this state, so a click has somewhere
   *  unambiguous to go. Several sessions in the same state means "open Agents instead
   *  of guessing which one." */
  focusTarget?: { kind: 'thread'; id: string } | { kind: 'terminal'; id: string }
}

/**
 * When each tracked unit last changed chip state, keyed by a stable id.
 *
 * Module-level and mutable on purpose, same pattern as `terminalSeq` above: both chip
 * instances (title bar, status bar) call `computeAgentStatus` with the same inputs on
 * the same tick and must land on the exact same "since", or their elapsed timers would
 * drift apart by a render. A plain object field on `Thread`/`TerminalTab` can't do this
 * — neither carries a "when did the current status start" timestamp.
 */
const chipStateSince = new Map<string, { state: AgentChipState; since: number }>()

function trackSince(key: string, state: AgentChipState): number {
  const prev = chipStateSince.get(key)
  const since = prev && prev.state === state ? prev.since : Date.now()
  chipStateSince.set(key, { state, since })
  return since
}

function threadChipState(status: ThreadStatus): AgentChipState {
  switch (status) {
    case 'running':
      return 'working'
    case 'waiting':
      return 'needsYou'
    case 'failed':
      return 'stopped'
    case 'idle':
    case 'done':
      return 'idle'
  }
}

/**
 * A read model over data that already exists, not a new detection pipeline. A thread's
 * own `status` is accurate and hook-driven — reuse it. A plain terminal session (started
 * outside the thread system, e.g. the sessions panel's primary "New session" button) has
 * no thread record for `ingestHook` to resolve, so hook events for it never reach the
 * renderer at all; the best available signal there is the most recent notification for
 * its session id, which only covers "waiting on you" and "finished", never "started
 * working". See PROGRESS.md for what closing that gap for real would need.
 */
export function computeAgentStatus(
  terminals: TerminalTab[],
  threads: Thread[],
  notificationLog: NotificationPayload[]
): AgentStatus {
  interface Unit {
    key: string
    state: AgentChipState
    focusTarget: NonNullable<AgentStatus['focusTarget']>
  }
  const units: Unit[] = []

  const openThreads = threads.filter((t) => t.endedAt === null)
  for (const thread of openThreads) {
    units.push({
      key: `thread:${thread.id}`,
      state: threadChipState(thread.status),
      focusTarget: { kind: 'thread', id: thread.id }
    })
  }

  // A thread's own session is already represented above — counting its terminal tab
  // too would double the total.
  const threadSessionIds = new Set(
    openThreads.map((t) => t.sessionId).filter((id): id is string => id !== null)
  )

  for (const tab of terminals) {
    if (tab.kind !== 'claude' || (tab.sessionId && threadSessionIds.has(tab.sessionId))) continue

    const state: AgentChipState =
      tab.exitCode !== null
        ? 'stopped'
        : !tab.sessionId
          ? 'working' // spawning; no signal yet, and "about to work" reads truer than "idle"
          : (() => {
              const last = notificationLog.find((n) => n.sessionId === tab.sessionId)
              return last?.event === 'permission' || last?.event === 'idle' ? 'needsYou' : 'idle'
            })()

    units.push({ key: `terminal:${tab.id}`, state, focusTarget: { kind: 'terminal', id: tab.id } })
  }

  // Forget anything that closed since the last call, or this leaks one entry per
  // session for the life of the app.
  const liveKeys = new Set(units.map((u) => u.key))
  for (const key of chipStateSince.keys()) {
    if (!liveKeys.has(key)) chipStateSince.delete(key)
  }

  for (const state of CHIP_PRIORITY) {
    if (state === 'idle') break // uniform empty/idle case handled below
    const matching = units.filter((u) => u.state === state)
    if (matching.length === 0) continue

    const since = Math.min(...matching.map((u) => trackSince(u.key, u.state)))
    return {
      state,
      count: matching.length,
      elapsedMs: Date.now() - since,
      focusTarget: matching.length === 1 ? matching[0].focusTarget : undefined
    }
  }

  return { state: 'idle', count: units.filter((u) => u.state === 'idle').length }
}

/**
 * Guards folder adoption against running twice.
 *
 * React StrictMode double-invokes mount effects in development, so the startup restore
 * fired twice and adopted the folder twice — leaving two duplicate Claude sessions.
 * The same would happen on a rapid double-click of Open Folder.
 *
 * Held by `adoptOnce`, which explains why it has to cover the whole flow.
 */
let adopting = false

export interface OpenFile {
  path: string
  /** Contents as last read or saved; compared against the editor buffer for dirtiness. */
  saved: string
}

export interface Toast {
  id: number
  message: string
}

interface State {
  workspace: Workspace | null
  /**
   * A queue rather than one slot: a single `error` field meant a second failure
   * silently replaced the first before the user had read it.
   */
  toasts: Toast[]

  // -- explorer -------------------------------------------------------------
  /** Children by directory path; '' is the root. Absent means not yet loaded. */
  tree: Record<string, DirEntry[]>
  expanded: Set<string>

  // -- editor ---------------------------------------------------------------
  openFiles: OpenFile[]
  activePath: string | null
  /** Files opened in this project, most-recent-first, surviving the tab itself closing.
   *  Powers the Start panel's "pick up where you left off" list. */
  recentFiles: string[]
  /**
   * Which tree row owns the single tab stop.
   *
   * The file tree is one control, not one control per file: without this every row was
   * tabbable, so Tab through a large repo meant hundreds of stops before reaching the
   * editor. Null until something is focused, when the first root row takes it.
   */
  treeFocus: string | null
  setTreeFocus: (path: string | null) => void
  dirty: Set<string>
  /**
   * Set when a file changed on disk underneath a clean editor buffer — typically
   * Claude editing the file you are looking at. The editor watches this and swaps its
   * buffer, preserving the cursor.
   */
  externalEdit: { path: string; contents: string; at: number } | null

  /** Line to scroll to and highlight once the file is open; cleared after use. */
  revealLine: { path: string; line: number; at: number } | null
  /**
   * Ask the Explorer to open its inline draft row, from outside the component — the
   * palette's `explorer.newFile`/`explorer.newFolder` commands can fire regardless of
   * which sidebar view is currently mounted. `at` is a nonce: the Explorer's effect keys
   * off it changing, not off any cleared/consumed flag.
   */
  newEntryRequest: { parent: string; isDirectory: boolean; at: number } | null

  // -- panels ---------------------------------------------------------------
  sidebar: SidebarView
  sidebarVisible: boolean
  previewVisible: boolean
  terminalVisible: boolean
  /** Panel sizes in pixels, dragged by the splitters and persisted. */
  sidebarWidth: number
  previewWidth: number
  terminalHeight: number
  /** File-only mode, opened by ⌘P and by "Go to File…" — the palette locks to files. */
  quickOpen: boolean
  /** Mixed mode, opened by ⌘K — files, `>` commands, `@` sessions, `:` a line. */
  paletteOpen: boolean

  // -- git ------------------------------------------------------------------
  git: GitStatus | null
  /** Path whose diff is showing in the editor area, if any. */
  diffPath: string | null

  // -- terminals ------------------------------------------------------------
  terminals: TerminalTab[]
  activeTerminal: string | null
  /** Seed the first Claude session of a folder with the end-to-end check prompt. */
  autoCheck: boolean
  /** Which Source Control sections are collapsed, persisted across launches. */
  gitSectionsCollapsed: Record<string, boolean>
  /** Collapses the preview's ports footer down to its header, to reclaim height for
   *  the page itself; persisted across launches like the sidebar/theme choices. */
  previewPortsCollapsed: boolean

  // -- threads --------------------------------------------------------------
  /** Instances and their subagents, parents before children. Owned by main. */
  threads: Thread[]
  selectedThread: string | null
  /** Whether the new-thread sheet is up. */
  newThreadOpen: boolean
  /** Mode the sheet should default to for this opening, overriding its usual
   *  instance-if-none-running/subagent-otherwise guess. Cleared on every plain open. */
  newThreadPresetMode: ThreadMode | null

  // -- notifications --------------------------------------------------------
  notifySettings: (NotificationSettings & { telegramConfigured: boolean }) | null
  /** Most recent alerts, newest first, so you can see what you missed. */
  notificationLog: NotificationPayload[]
  settingsOpen: boolean
  /** Whether the guide overlay is up. */
  guideOpen: boolean

  // -- telemetry ------------------------------------------------------------
  /** Null until main answers. `unasked` is what puts the consent card on screen. */
  telemetry: { consent: 'unasked' | 'granted' | 'denied'; configured: boolean; installId: string | null } | null
  setTelemetryConsent: (granted: boolean) => Promise<void>
  /** Count something the renderer can see. Never carries content, only a name. */
  trackFeature: (feature: Feature, theme?: string) => void

  // -- updates --------------------------------------------------------------
  /** Null until main answers, which keeps the status bar quiet during startup. */
  update: (UpdateState & { enabled: boolean }) | null
  setUpdatesEnabled: (enabled: boolean) => Promise<void>
  /** Quit and install. Warns first: this kills every terminal. */
  installUpdate: () => Promise<void>
  /** What tooling the machine has. Null until the first check comes back. */
  systemCheck: SystemCheck | null

  // -- preview --------------------------------------------------------------
  ports: PortInfo[]
  previewUrl: string
  /** True once the CDP debugger is attached, i.e. Claude can drive the page. */
  previewAttached: boolean
  /**
   * Same nonce pattern as `newEntryRequest`: the `preview.reload` command lives outside
   * `Preview.tsx`, which is the only place holding the webview ref it needs to reload.
   */
  previewReloadRequest: number
  /** Same nonce pattern: the header's Clear action lives outside `SearchPanel.tsx`. */
  searchClearRequest: number
  /** Same nonce pattern: the header's overflow menu lives outside `GitPanel.tsx`, which
   *  owns the discard confirmation dialog. */
  discardAllRequest: number
  /** Same nonce pattern: the header's Recount button lives outside `ClaudePanel.tsx`. */
  claudeRecountRequest: number

  // -- adaptation -----------------------------------------------------------
  /** The flourish currently playing, if any. */
  adaptation: Adaptation | null
  /** Preview fills the whole window, for looking at a real layout. */
  previewFullscreen: boolean
  /** Chromium's element picker is armed in the preview. */
  inspecting: boolean
  /** The element the user picked, awaiting a comment. */
  pickedElement: PickedElement | null

  setError: (error: string | null) => void
  dismissToast: (id: number) => void
  openFolder: () => Promise<void>
  restoreLastFolder: () => Promise<void>
  loadDir: (dir: string) => Promise<void>
  toggleDir: (dir: string) => Promise<void>
  /** Collapse every open directory in the tree, so a deep expansion has a way back to the top. */
  collapseAll: () => void
  /** Open the Explorer's inline new-file/new-folder draft row from anywhere. */
  requestNewEntry: (parent: string, isDirectory: boolean) => void
  openFile: (path: string, line?: number) => Promise<void>
  closeFile: (path: string) => void
  markDirty: (path: string, isDirty: boolean) => void
  saveFile: (path: string, contents: string) => Promise<void>
  refreshGit: () => Promise<void>
  showDiff: (path: string | null) => void
  setSidebar: (view: SidebarView) => void
  /** Same as `setSidebar`, but never toggles it shut when already on that view — for
   *  callers that mean "make sure this is showing," not "switch to, or collapse." */
  showSidebar: (view: SidebarView) => void
  togglePanel: (panel: 'sidebar' | 'preview' | 'terminal') => void
  setPanelSize: (panel: 'sidebar' | 'preview' | 'terminal', px: number) => void
  setQuickOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  setPreviewAttached: (attached: boolean) => void
  /** Mark an adaptation. Ignored while one is playing, or if it is turned off. */
  triggerAdaptation: (skill: string) => void
  /** Play it on demand, ignoring the settings and the gap. For the Test button. */
  testAdaptation: () => void
  clearAdaptation: () => void
  togglePreviewFullscreen: () => void
  startInspect: () => Promise<void>
  stopInspect: () => Promise<void>
  clearPickedElement: () => void
  /** Send a comment about the picked element to the active Claude session. */
  sendElementComment: (comment: string) => Promise<void>
  /** Request a reload from outside `Preview.tsx`, e.g. the command palette. */
  requestPreviewReload: () => void
  requestSearchClear: () => void
  requestDiscardAll: () => void
  requestClaudeRecount: () => void
  /**
   * Send arbitrary text to the most relevant Claude session, starting one if none is
   * running. Same "prefer a live Claude session" rule as `sendElementComment`.
   */
  askClaude: (text: string) => Promise<void>

  // -- terminals ------------------------------------------------------------
  /** Open a new terminal tab and focus it. Returns its local id. */
  addTerminal: (
    kind: TerminalKind,
    opts?: { prompt?: string; title?: string; command?: string; args?: string[] }
  ) => string
  /** Rename a tab, e.g. from the double-click-to-edit interaction. */
  renameTerminal: (id: string, title: string) => void
  closeTerminal: (id: string) => void
  /** Nonce watched by TerminalPanel, so a global shortcut can ask for the active
   *  session to be closed without bypassing its own confirmation dialog. */
  closeActiveTerminalRequest: number
  requestCloseActiveTerminal: () => void
  setActiveTerminal: (id: string) => void
  /** Kill and respawn a tab's process, keeping the tab in place. */
  restartTerminal: (id: string) => void
  attachSession: (id: string, sessionId: string) => void
  markTerminalExited: (sessionId: string, exitCode: number) => void
  setAutoCheck: (on: boolean) => void
  togglePreviewPortsCollapsed: () => void
  toggleGitSection: (id: string) => void
  /** Start a fresh Claude session seeded with the project-check prompt. */
  runProjectCheck: () => void
  /** Start a Claude session that walks every screen and flow in the running UI. */
  runUiAudit: () => void
  /** Start `command` in a fresh shell tab, e.g. the project's `npm run dev`. */
  runDevServer: (command: string, args: string[]) => void

  // -- threads --------------------------------------------------------------
  setNewThreadOpen: (open: boolean) => void
  /** Open the sheet already set to a specific mode, e.g. "instance" for the sessions
   *  menu's worktree entry, rather than the sheet's own running-instances guess. */
  openNewThreadAs: (mode: ThreadMode) => void
  /** Select a thread and bring its terminal to the front. */
  selectThread: (id: string) => void
  createThread: (opts: NewThreadOptions) => Promise<void>
  closeThread: (id: string, opts?: { removeWorktree?: boolean }) => Promise<void>
  /** Which thread the land sheet is open for, or null. */
  landingThread: string | null
  landPreview: MergePreview | null
  /** Open the land sheet and fetch what merging would do. */
  openLandThread: (id: string) => Promise<void>
  closeLandThread: () => void
  landThread: (id: string, opts?: { deleteBranch?: boolean }) => Promise<void>

  // -- notifications --------------------------------------------------------
  loadNotifySettings: () => Promise<void>
  updateNotifySettings: (patch: Partial<NotificationSettings>) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setGuideOpen: (open: boolean) => void
  loadSystemCheck: () => Promise<void>
  /** Load a URL into the preview, revealing the panel if it is collapsed. */
  showInPreview: (url: string) => void
  setPreviewUrl: (url: string) => void
}

/** Panel sizes survive restarts; they are pure layout, so localStorage is enough. */
const LAYOUT_KEY = 'metsuke.layout'

function loadLayout(): { sidebarWidth: number; previewWidth: number; terminalHeight: number } {
  const fallback = { sidebarWidth: 280, previewWidth: 440, terminalHeight: 260 }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
  } catch {
    return fallback
  }
}

/**
 * "Pick up where you left off" needs history, not just the currently-open tabs — those
 * get wiped every time a folder closes. Same mechanism as everything else lightweight
 * here (`LAST_FOLDER_KEY`, `LAYOUT_KEY`): one localStorage key, keyed by workspace root
 * so switching projects does not show another project's files.
 */
const RECENT_FILES_KEY = 'metsuke.recentFiles'
const RECENT_FILES_PER_PROJECT = 10

/** Extensions that are never something you were "working on" — opening one is almost
 *  always incidental (checking an icon, previewing an asset), not resuming a task, so
 *  it does not belong in "Pick up where you left off." */
const NON_RECENTABLE_EXTENSIONS = new Set([
  'ico', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'mp3', 'wav', 'mov', 'avi', 'webm',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'exe', 'dll', 'so', 'dylib', 'wasm', 'db', 'sqlite'
])

export function isRecentableFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === undefined || !NON_RECENTABLE_EXTENSIONS.has(ext)
}

function loadRecentFiles(root: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '{}') as Record<string, string[]>
    return Array.isArray(all[root]) ? all[root] : []
  } catch {
    return []
  }
}

/** Most-recent-first, deduplicated, capped. Returns the updated list for this project. */
function saveRecentFile(root: string, path: string): string[] {
  let all: Record<string, string[]> = {}
  try {
    all = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '{}') as Record<string, string[]>
  } catch {
    all = {}
  }
  const list = [path, ...(all[root] ?? []).filter((p) => p !== path)].slice(0, RECENT_FILES_PER_PROJECT)
  all[root] = list
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(all))
  } catch {
    // Private mode or a locked-down profile — the list still works for this session.
  }
  return list
}

export const useStore = create<State>((set, get) => ({
  workspace: null,
  toasts: [],
  tree: {},
  expanded: new Set(),
  openFiles: [],
  recentFiles: [],
  activePath: null,
  treeFocus: null,
  setTreeFocus: (treeFocus) => set({ treeFocus }),
  dirty: new Set(),
  externalEdit: null,
  revealLine: null,
  newEntryRequest: null,
  sidebar: 'explorer',
  sidebarVisible: true,
  previewVisible: true,
  terminalVisible: true,
  closeActiveTerminalRequest: 0,
  ...loadLayout(),
  quickOpen: false,
  paletteOpen: false,
  git: null,
  diffPath: null,
  terminals: [],
  activeTerminal: null,
  autoCheck: localStorage.getItem(AUTO_CHECK_KEY) !== 'off',
  previewPortsCollapsed: localStorage.getItem(PORTS_COLLAPSED_KEY) === 'on',
  gitSectionsCollapsed: loadGitSectionsCollapsed(),
  threads: [],
  selectedThread: null,
  newThreadOpen: false,
  newThreadPresetMode: null,
  landingThread: null,
  landPreview: null,
  notifySettings: null,
  notificationLog: [],
  update: null,
  telemetry: null,
  settingsOpen: false,
  guideOpen: false,
  systemCheck: null,
  ports: [],
  previewUrl: '',
  previewAttached: false,
  previewReloadRequest: 0,
  searchClearRequest: 0,
  discardAllRequest: 0,
  claudeRecountRequest: 0,
  adaptation: null,
  previewFullscreen: false,
  inspecting: false,
  pickedElement: null,

  setError: (error) =>
    set((s) =>
      error === null
        ? { toasts: [] }
        : // Collapse an identical repeat rather than stacking the same message twice.
          s.toasts.at(-1)?.message === error
          ? s
          : { toasts: [...s.toasts, { id: Date.now() + Math.random(), message: error }] }
    ),

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openFolder: async () => {
    await adoptOnce(() => call('workspace:open'), true)
  },

  restoreLastFolder: async () => {
    await adoptOnce(async () => {
      const last = localStorage.getItem(LAST_FOLDER_KEY)
      if (!last) return null

      // The folder may have been moved or deleted since last launch. That is not worth
      // an error banner on startup — just forget it and open empty.
      const result = await window.api.invoke('workspace:openPath', last)
      if (!result.ok) {
        localStorage.removeItem(LAST_FOLDER_KEY)
        return null
      }
      return result.value
    }, false)
  },

  loadDir: async (dir) => {
    const entries = await call('files:list', dir)
    if (!entries) return
    set((s) => ({ tree: { ...s.tree, [dir]: entries } }))
  },

  toggleDir: async (dir) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(dir)) {
      expanded.delete(dir)
    } else {
      expanded.add(dir)
      if (!get().tree[dir]) await get().loadDir(dir)
    }
    set({ expanded })
  },

  requestNewEntry: (parent, isDirectory) => set({ newEntryRequest: { parent, isDirectory, at: Date.now() } }),

  collapseAll: () => set({ expanded: new Set() }),

  openFile: async (path, line) => {
    const reveal = line ? { path, line, at: Date.now() } : null
    set({ diffPath: null })

    const root = get().workspace?.root
    if (root && isRecentableFile(path)) set({ recentFiles: saveRecentFile(root, path) })

    if (get().openFiles.some((f) => f.path === path)) {
      set({ activePath: path, revealLine: reveal })
      return
    }

    const contents = await call('files:read', path)
    if (contents === null) return
    set((s) => ({
      openFiles: [...s.openFiles, { path, saved: contents }],
      activePath: path,
      revealLine: reveal
    }))
  },

  closeFile: (path) =>
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      const dirty = new Set(s.dirty)
      dirty.delete(path)
      return {
        openFiles,
        dirty,
        // Fall back to the last remaining tab so the editor area is never blank
        // while tabs still exist.
        activePath:
          s.activePath === path ? (openFiles.at(-1)?.path ?? null) : s.activePath
      }
    }),

  markDirty: (path, isDirty) =>
    set((s) => {
      const dirty = new Set(s.dirty)
      if (isDirty) dirty.add(path)
      else dirty.delete(path)
      return { dirty }
    }),

  saveFile: async (path, contents) => {
    const result = await call('files:write', path, contents)
    if (result === null) return
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, saved: contents } : f))
    }))
    get().markDirty(path, false)
    await get().refreshGit()
  },

  refreshGit: async () => {
    if (!get().workspace?.isGitRepo) return set({ git: null })
    const status = await window.api.invoke('git:status')
    // A git failure here is background noise (mid-rebase, index lock); the panel just
    // keeps its last known state rather than shouting at the user.
    if (status.ok) set({ git: status.value })
  },

  showDiff: (diffPath) => set({ diffPath }),

  /** Clicking the active view's icon collapses the sidebar, as VS Code does. */
  setSidebar: (view) => {
    // Counted when a panel is opened, not when it is toggled shut, so the number means
    // "people used this" rather than "people clicked this".
    const opening = !(get().sidebar === view && get().sidebarVisible)
    if (opening) {
      const feature = ({
        explorer: 'panel_files',
        git: 'panel_git',
        search: 'panel_search',
        agents: 'panel_threads',
        claude: 'panel_claude'
      } as const)[view]
      if (feature) get().trackFeature(feature)
    }

    set((s) =>
      s.sidebar === view && s.sidebarVisible
        ? { sidebarVisible: false }
        : { sidebar: view, sidebarVisible: true }
    )
  },

  showSidebar: (view) => {
    const opening = !(get().sidebar === view && get().sidebarVisible)
    if (opening) {
      const feature = ({
        explorer: 'panel_files',
        git: 'panel_git',
        search: 'panel_search',
        agents: 'panel_threads',
        claude: 'panel_claude'
      } as const)[view]
      if (feature) get().trackFeature(feature)
    }
    set({ sidebar: view, sidebarVisible: true })
  },

  togglePanel: (panel) =>
    set((s) => {
      if (panel === 'sidebar') return { sidebarVisible: !s.sidebarVisible }
      if (panel === 'preview') return { previewVisible: !s.previewVisible }
      return { terminalVisible: !s.terminalVisible }
    }),

  setPanelSize: (panel, px) => {
    // Clamped so a panel can never be dragged to nothing, which would leave the user
    // with an invisible splitter and no way back.
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
    const key =
      panel === 'sidebar' ? 'sidebarWidth' : panel === 'preview' ? 'previewWidth' : 'terminalHeight'
    // The sidebar's floor is 200, not the generic 160: below that its own header (the
    // one zone every panel shares) starts truncating the title and its actions (K14).
    const value =
      panel === 'terminal'
        ? clamp(px, 80, window.innerHeight - 200)
        : panel === 'sidebar'
          ? clamp(px, 200, window.innerWidth - 400)
          : clamp(px, 160, window.innerWidth - 400)

    set({ [key]: value } as Partial<State>)
    const { sidebarWidth, previewWidth, terminalHeight } = get()
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarWidth, previewWidth, terminalHeight }))
  },

  setQuickOpen: (quickOpen) => {
    if (quickOpen) get().trackFeature('quick_open')
    set({ quickOpen })
  },
  setPaletteOpen: (paletteOpen) => {
    if (paletteOpen) get().trackFeature('command_palette')
    set({ paletteOpen })
  },
  setPreviewAttached: (previewAttached) => set({ previewAttached }),

  triggerAdaptation: (skill) => {
    // Off by setting, or the user has asked the OS for less movement.
    if (get().notifySettings?.adaptation === false) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    // One at a time, and never twice in quick succession: Claude often reaches for
    // several new tools in a row, and five wheels back to back is noise, not ceremony.
    const now = Date.now()
    if (get().adaptation) return
    if (now - lastAdaptAt < ADAPT_GAP_MS) return

    lastAdaptAt = now
    set({ adaptation: { skill, at: now } })
  },

  /*
   * Deliberately ignores both the setting and the twelve second gap.
   *
   * Pressing Test and getting nothing back, because the real thing happens to have
   * fired recently or because you are testing before switching the feature on, reads as
   * broken rather than as suppressed. It still refuses to stack on one already playing,
   * which would only look wrong. Reduced motion is honoured for the automatic trigger
   * but not here, since pressing the button is an explicit request to see it.
   */
  testAdaptation: () => {
    if (get().adaptation) return
    const now = Date.now()
    lastAdaptAt = now
    set({ adaptation: { skill: 'this very button', at: now } })
  },

  clearAdaptation: () => set({ adaptation: null }),

  togglePreviewFullscreen: () =>
    set((s) => ({ previewFullscreen: !s.previewFullscreen, previewVisible: true })),

  startInspect: async () => {
    if (!get().previewUrl) return get().setError('Load a page in the preview first')
    set({ inspecting: true, previewVisible: true })
    if ((await call('preview:inspectStart')) === null) set({ inspecting: false })
  },

  stopInspect: async () => {
    set({ inspecting: false })
    await call('preview:inspectStop')
  },

  clearPickedElement: () => set({ pickedElement: null }),

  sendElementComment: async (comment) => {
    const { pickedElement, terminals, previewUrl } = get()
    if (!pickedElement) return

    // Prefer a live Claude session; a shell would just print the text back at you.
    const target = terminals.find((t) => t.kind === 'claude' && t.sessionId)
    if (!target?.sessionId) {
      return get().setError('No Claude session is running — start one in the terminal panel')
    }

    if ((await call('preview:comment', target.sessionId, pickedElement, comment, previewUrl)) === null) {
      return
    }
    set({ pickedElement: null, activeTerminal: target.id, terminalVisible: true })
  },

  requestPreviewReload: () => set((s) => ({ previewReloadRequest: s.previewReloadRequest + 1 })),
  requestSearchClear: () => set((s) => ({ searchClearRequest: s.searchClearRequest + 1 })),
  requestDiscardAll: () => set((s) => ({ discardAllRequest: s.discardAllRequest + 1 })),
  requestClaudeRecount: () => set((s) => ({ claudeRecountRequest: s.claudeRecountRequest + 1 })),

  askClaude: async (text) => {
    // Flattened to one line: an embedded newline would submit early and strand the
    // rest as a second, meaningless prompt — same reasoning as sendElementComment.
    const oneLine = text.replace(/\s+/g, ' ').trim()
    if (!oneLine) return
    const target = get().terminals.find((t) => t.kind === 'claude' && t.sessionId)
    if (target?.sessionId) {
      if ((await call('terminal:write', target.sessionId, oneLine)) === null) return
      // Separate write so the text is fully buffered before submission — sending it
      // combined with '\r' has the pty treat the whole thing as a paste and insert a
      // literal newline instead of submitting.
      if ((await call('terminal:write', target.sessionId, '\r')) === null) return
      set({ activeTerminal: target.id, terminalVisible: true })
    } else {
      get().addTerminal('claude', { prompt: oneLine })
    }
  },

  // -- terminals ------------------------------------------------------------

  addTerminal: (kind, opts = {}) => {
    const id = nextTerminalId()
    const sameKind = get().terminals.filter((t) => t.kind === kind).length
    // Every "claude" tab used to be named "claude", unusable once more than one was
    // open. Prefer what it was told to do; "Claude 2", "Claude 3"… only when there is
    // genuinely nothing to derive from.
    const derived = opts.prompt ? titleFromPrompt(opts.prompt) : null
    const tab: TerminalTab = {
      id,
      kind,
      title: opts.title ?? derived ?? (sameKind === 0 ? KIND_LABEL[kind] : `${KIND_LABEL[kind]} ${sameKind + 1}`),
      sessionId: null,
      exitCode: null,
      prompt: opts.prompt,
      command: opts.command,
      args: opts.args
    }
    set((s) => ({ terminals: [...s.terminals, tab], activeTerminal: id, terminalVisible: true }))
    return id
  },

  renameTerminal: (id, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    set((s) => ({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, title: trimmed } : t)) }))
  },

  closeTerminal: (id) => {
    const tab = get().terminals.find((t) => t.id === id)
    if (tab?.sessionId) void call('terminal:kill', tab.sessionId)

    set((s) => {
      const closedIndex = s.terminals.findIndex((t) => t.id === id)
      const terminals = s.terminals.filter((t) => t.id !== id)
      // Focus the neighbour that slides into the closed tab's slot, not whatever
      // happens to be last in the strip.
      const activeTerminal =
        s.activeTerminal === id
          ? (terminals[Math.min(closedIndex, terminals.length - 1)]?.id ?? null)
          : s.activeTerminal
      // Closing the last session by hand collapses back to the Start panel rather
      // than leaving the Sessions panel open on its own empty state — but a panel
      // opened with zero sessions already in it (⌘J, the title-bar toggle) should
      // still show that empty state, so this only fires here, not on open.
      return terminals.length === 0
        ? { terminals, activeTerminal, terminalVisible: false }
        : { terminals, activeTerminal }
    })
  },

  requestCloseActiveTerminal: () => set((s) => ({ closeActiveTerminalRequest: s.closeActiveTerminalRequest + 1 })),

  setActiveTerminal: (activeTerminal) => set({ activeTerminal }),

  restartTerminal: (id) => {
    const tab = get().terminals.find((t) => t.id === id)
    if (tab?.sessionId) void call('terminal:kill', tab.sessionId)
    // Clearing sessionId is the signal the instance watches to spawn again.
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === id ? { ...t, sessionId: null, exitCode: null } : t
      )
    }))
  },

  attachSession: (id, sessionId) =>
    set((s) => ({
      terminals: s.terminals.map((t) => (t.id === id ? { ...t, sessionId, exitCode: null } : t))
    })),

  markTerminalExited: (sessionId, exitCode) =>
    set((s) => ({
      terminals: s.terminals.map((t) =>
        t.sessionId === sessionId ? { ...t, sessionId: null, exitCode } : t
      )
    })),

  setAutoCheck: (autoCheck) => {
    localStorage.setItem(AUTO_CHECK_KEY, autoCheck ? 'on' : 'off')
    set({ autoCheck })
  },

  togglePreviewPortsCollapsed: () => {
    const previewPortsCollapsed = !get().previewPortsCollapsed
    localStorage.setItem(PORTS_COLLAPSED_KEY, previewPortsCollapsed ? 'on' : 'off')
    set({ previewPortsCollapsed })
  },

  toggleGitSection: (id) => {
    const gitSectionsCollapsed = { ...get().gitSectionsCollapsed, [id]: !get().gitSectionsCollapsed[id] }
    localStorage.setItem(GIT_SECTIONS_KEY, JSON.stringify(gitSectionsCollapsed))
    set({ gitSectionsCollapsed })
  },

  runProjectCheck: () => {
    if (!get().workspace) return get().setError('Open a folder before running a project check')
    get().addTerminal('claude', { prompt: PROJECT_CHECK_PROMPT, title: 'project check' })
    get().triggerAdaptation('the whole project')
  },

  runUiAudit: () => {
    if (!get().workspace) return get().setError('Open a folder before testing the UI')
    set({ previewVisible: true })
    get().addTerminal('claude', { prompt: UI_AUDIT_PROMPT, title: 'UI audit' })
    get().triggerAdaptation('every screen you have')
  },

  runDevServer: (command, args) => {
    if (!get().workspace) return get().setError('Open a folder before starting a dev server')
    get().addTerminal('shell', { command, args, title: [command, ...args].join(' ') })
  },

  // -- threads --------------------------------------------------------------

  setNewThreadOpen: (newThreadOpen) => set({ newThreadOpen, newThreadPresetMode: null }),
  openNewThreadAs: (mode) => set({ newThreadOpen: true, newThreadPresetMode: mode }),

  selectThread: (id) => {
    set({ selectedThread: id })

    const thread = get().threads.find((t) => t.id === id)
    // A subagent has no terminal of its own, so selecting one shows its parent, which is
    // the session its output is actually in.
    const owner = thread?.parentId
      ? get().threads.find((t) => t.id === thread.parentId)
      : thread
    if (!owner?.terminalId) return

    // Threads carry the main-process session id; tabs are keyed by their own local id.
    const tab = get().terminals.find((t) => t.sessionId === owner.terminalId)
    if (tab) set({ activeTerminal: tab.id, terminalVisible: true })
  },

  createThread: async (opts) => {
    const thread = await call('threads:create', opts)
    if (!thread) return

    set({ newThreadOpen: false, selectedThread: thread.id })

    /*
     * An instance thread spawns its pty in main, so the renderer needs a tab pointing at
     * that existing session rather than one that spawns a second `claude`. Attaching by
     * session id is exactly what a reload does.
     */
    if (thread.mode === 'instance' && thread.terminalId) {
      const localId = get().addTerminal('claude', { title: thread.title })
      get().attachSession(localId, thread.terminalId)
    }
    get().triggerAdaptation(thread.mode === 'subagent' ? 'delegating' : thread.title)
  },

  openLandThread: async (id) => {
    // Show the sheet immediately and fill it in when git answers: computing a merge
    // preview shells out, and a sheet that appears only after that reads as a dead click.
    set({ landingThread: id, landPreview: null })
    const preview = await call('threads:mergePreview', id)
    // Ignore a preview that arrives after the user moved on.
    if (get().landingThread === id) set({ landPreview: preview })
  },

  closeLandThread: () => set({ landingThread: null, landPreview: null }),

  landThread: async (id, opts = {}) => {
    const thread = get().threads.find((t) => t.id === id)

    // Same reason as closeThread: the tab would otherwise respawn a session that gets
    // adopted as a new thread, and the row would come back with nothing behind it.
    if (thread?.terminalId) {
      const tab = get().terminals.find((t) => t.sessionId === thread.terminalId)
      if (tab) get().closeTerminal(tab.id)
    }

    if ((await call('threads:merge', id, opts)) === null) return

    set((s) => ({
      landingThread: null,
      landPreview: null,
      selectedThread: s.selectedThread === id ? null : s.selectedThread
    }))
    // The merge moved the branch under the file tree and the git panel.
    await get().refreshGit()
    await get().loadDir('')
  },

  closeThread: async (id, opts = {}) => {
    const thread = get().threads.find((t) => t.id === id)

    /*
     * Close the tab before ending the thread, not after.
     *
     * A tab whose session dies underneath it spawns a replacement — that is exactly how
     * restart is implemented — and main adopts every new `claude` pty as a thread. So
     * killing the pty alone put the row straight back, this time with no branch and no
     * worktree, which left no way to get rid of it at all.
     *
     * A subagent has no tab of its own; it runs inside its parent's session.
     */
    if (thread?.terminalId) {
      const tab = get().terminals.find((t) => t.sessionId === thread.terminalId)
      if (tab) get().closeTerminal(tab.id)
    }

    if ((await call('threads:close', id, opts)) === null) return
    set((s) => ({ selectedThread: s.selectedThread === id ? null : s.selectedThread }))
  },

  // -- notifications --------------------------------------------------------

  loadNotifySettings: async () => {
    const settings = await call('notify:get')
    if (settings) set({ notifySettings: settings })
  },

  updateNotifySettings: async (patch) => {
    if ((await call('notify:set', patch)) === null) return
    await get().loadNotifySettings()
  },

  // -- telemetry ------------------------------------------------------------

  setTelemetryConsent: async (granted) => {
    if ((await call('telemetry:setConsent', granted)) === null) return
    const state = await call('telemetry:get')
    if (state) set({ telemetry: state })
  },

  trackFeature: (feature, theme) => {
    // Fire and forget by design: a counter must never be able to fail a click.
    void window.api.invoke('telemetry:record', { name: 'feature_used', feature, theme })
  },

  // -- updates --------------------------------------------------------------

  setUpdatesEnabled: async (enabled) => {
    if ((await call('updates:setEnabled', enabled)) === null) return
    const state = await call('updates:get')
    if (state) set({ update: state })
  },

  installUpdate: async () => {
    await call('updates:install')
  },

  setSettingsOpen: (settingsOpen) => {
    if (settingsOpen) get().trackFeature('settings_opened')
    set({ settingsOpen })
  },
  setGuideOpen: (guideOpen) => {
    if (guideOpen) get().trackFeature('guide_opened')
    set({ guideOpen })
  },

  loadSystemCheck: async () => {
    // Probing runs a login shell, which is slow enough to be worth doing once.
    if (get().systemCheck) return
    const result = await call('system:check')
    if (result) set({ systemCheck: result })
  },

  showInPreview: (previewUrl) => set({ previewUrl, previewVisible: true }),
  setPreviewUrl: (previewUrl) => set({ previewUrl })
}))

// In dev, expose the store for inspection from devtools or over CDP. The editor can
// drive its own UI for testing (see the debug port in src/main/index.ts); being able to
// read state directly turns "the panel looks wrong" into an actual number.
if (import.meta.env.DEV) {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}

/** Subscribe to the main process's push events. Called once at startup. */
export function wireEvents(): () => void {
  // The ports event only fires when the list *changes*, and the first scan happens
  // before the renderer exists — so without an initial fetch the Ports panel sat empty
  // until something happened to start or stop a server.
  void call('ports:list').then((ports) => ports && useStore.setState({ ports }))
  // Same reasoning for threads: main owns the list and only pushes on change, so a
  // renderer that reloads mid-session would otherwise show none of the running ones.
  void call('threads:list').then((threads) => threads && useStore.setState({ threads }))

  const unsubscribers = [
    window.api.on('threads:changed', (threads) => useStore.setState({ threads })),

    window.api.on('files:changed', (paths) => {
      const { tree, loadDir, openFiles } = useStore.getState()

      // Reload only the directories we have actually loaded and that changed.
      const dirs = new Set(paths.map((p) => p.split('/').slice(0, -1).join('/')))
      for (const dir of dirs) if (tree[dir] !== undefined) void loadDir(dir)

      // If Claude edited the file being viewed and the user has no unsaved changes,
      // pull in the new contents so the editor reflects reality.
      const changed = new Set(paths)
      for (const file of openFiles) {
        if (!changed.has(file.path)) continue
        if (useStore.getState().dirty.has(file.path)) continue
        void call('files:read', file.path).then((contents) => {
          if (contents === null || contents === file.saved) return
          useStore.setState((s) => ({
            openFiles: s.openFiles.map((f) =>
              f.path === file.path ? { ...f, saved: contents } : f
            ),
            // Timestamped so the editor re-applies even if the same file changes twice.
            externalEdit: { path: file.path, contents, at: Date.now() }
          }))
        })
      }
    }),

    window.api.on('notify:fired', (payload) => {
      const settings = useStore.getState().notifySettings

      useStore.setState((s) => ({
        notificationLog: [payload, ...s.notificationLog].slice(0, 50)
      }))

      if (settings?.sound.enabled !== false) {
        void playAlertSound(settings?.sound.path ?? null, settings?.sound.volume ?? 0.7, () =>
          call('notify:sound')
        )
      }
    }),

    // "Go to Claude" from the floating alert lands here.
    window.api.on('notify:goto', (sessionId) => {
      const { terminals, setActiveTerminal, terminalVisible, togglePanel } = useStore.getState()
      const tab =
        terminals.find((t) => t.sessionId === sessionId) ?? terminals.find((t) => t.kind === 'claude')
      if (tab) setActiveTerminal(tab.id)
      if (!terminalVisible) togglePanel('terminal')
    }),

    // Picking an element also ends inspect mode: Chromium exits it after one click.
    window.api.on('preview:open', (url) => {
      // Claude navigating with the pane shut. Make it visible as well as loaded: opening
      // a pane the user cannot see would be worse than refusing to open one at all.
      useStore.setState({ previewVisible: true })
      void useStore.getState().showInPreview(url)
    }),
    window.api.on('preview:elementPicked', (element) =>
      useStore.setState({ pickedElement: element, inspecting: false })
    ),

    window.api.on('adapt:fired', (adaptation) =>
      useStore.getState().triggerAdaptation(adaptation.skill)
    ),

    window.api.on('git:changed', (git) => useStore.setState({ git })),
    window.api.on('ports:changed', (ports) => useStore.setState({ ports })),
    window.api.on('app:error', (message) => useStore.getState().setError(message)),
    window.api.on('updates:state', (state) =>
      useStore.setState((s) => ({
        // The pushed state carries no preference, so keep the one already known rather
        // than flipping the settings toggle every time a download reports progress.
        update: { ...state, enabled: s.update?.enabled ?? true }
      }))
    )
  ]

  return () => unsubscribers.forEach((off) => off())
}
