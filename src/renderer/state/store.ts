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
  NewThreadOptions,
  Workspace
} from '@shared/ipc'

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

const LAST_FOLDER_KEY = 'open-claude.lastFolder'

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

export type SidebarView = 'explorer' | 'git' | 'search' | 'ports' | 'threads' | 'claude'

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
}

/**
 * What the editor asks Claude to do the moment you open a folder.
 *
 * Deliberately read-only: this runs unattended, so it inspects and reports rather than
 * editing. Anything it wants to change, it proposes and you approve in the same session.
 */
export const PROJECT_CHECK_PROMPT = `You have just been opened in this folder by the Open Claude editor. Do an end-to-end check of the project and report what you find.

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

const AUTO_CHECK_KEY = 'open-claude.autoCheck'

/** Minimum quiet period between flourishes, so a burst of new tools plays once. */
const ADAPT_GAP_MS = 12_000
let lastAdaptAt = 0

let terminalSeq = 0
const nextTerminalId = (): string => `t${++terminalSeq}`

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
  dirty: Set<string>
  /**
   * Set when a file changed on disk underneath a clean editor buffer — typically
   * Claude editing the file you are looking at. The editor watches this and swaps its
   * buffer, preserving the cursor.
   */
  externalEdit: { path: string; contents: string; at: number } | null

  /** Line to scroll to and highlight once the file is open; cleared after use. */
  revealLine: { path: string; line: number; at: number } | null

  // -- panels ---------------------------------------------------------------
  sidebar: SidebarView
  sidebarVisible: boolean
  previewVisible: boolean
  terminalVisible: boolean
  /** Panel sizes in pixels, dragged by the splitters and persisted. */
  sidebarWidth: number
  previewWidth: number
  terminalHeight: number
  quickOpen: boolean

  // -- git ------------------------------------------------------------------
  git: GitStatus | null
  /** Path whose diff is showing in the editor area, if any. */
  diffPath: string | null

  // -- terminals ------------------------------------------------------------
  terminals: TerminalTab[]
  activeTerminal: string | null
  /** Seed the first Claude session of a folder with the end-to-end check prompt. */
  autoCheck: boolean

  // -- threads --------------------------------------------------------------
  /** Instances and their subagents, parents before children. Owned by main. */
  threads: Thread[]
  selectedThread: string | null
  /** Whether the new-thread sheet is up. */
  newThreadOpen: boolean

  // -- notifications --------------------------------------------------------
  notifySettings: (NotificationSettings & { telegramConfigured: boolean }) | null
  /** Most recent alerts, newest first, so you can see what you missed. */
  notificationLog: NotificationPayload[]
  settingsOpen: boolean
  /** Whether the guide overlay is up. */
  guideOpen: boolean
  /** What tooling the machine has. Null until the first check comes back. */
  systemCheck: SystemCheck | null

  // -- preview --------------------------------------------------------------
  ports: PortInfo[]
  previewUrl: string
  /** True once the CDP debugger is attached, i.e. Claude can drive the page. */
  previewAttached: boolean

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
  openFile: (path: string, line?: number) => Promise<void>
  closeFile: (path: string) => void
  markDirty: (path: string, isDirty: boolean) => void
  saveFile: (path: string, contents: string) => Promise<void>
  refreshGit: () => Promise<void>
  showDiff: (path: string | null) => void
  setSidebar: (view: SidebarView) => void
  togglePanel: (panel: 'sidebar' | 'preview' | 'terminal') => void
  setPanelSize: (panel: 'sidebar' | 'preview' | 'terminal', px: number) => void
  setQuickOpen: (open: boolean) => void
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

  // -- terminals ------------------------------------------------------------
  /** Open a new terminal tab and focus it. Returns its local id. */
  addTerminal: (kind: TerminalKind, opts?: { prompt?: string; title?: string }) => string
  closeTerminal: (id: string) => void
  setActiveTerminal: (id: string) => void
  /** Kill and respawn a tab's process, keeping the tab in place. */
  restartTerminal: (id: string) => void
  attachSession: (id: string, sessionId: string) => void
  markTerminalExited: (sessionId: string, exitCode: number) => void
  setAutoCheck: (on: boolean) => void
  /** Start a fresh Claude session seeded with the project-check prompt. */
  runProjectCheck: () => void
  /** Start a Claude session that walks every screen and flow in the running UI. */
  runUiAudit: () => void

  // -- threads --------------------------------------------------------------
  setNewThreadOpen: (open: boolean) => void
  /** Select a thread and bring its terminal to the front. */
  selectThread: (id: string) => void
  createThread: (opts: NewThreadOptions) => Promise<void>
  closeThread: (id: string, opts?: { removeWorktree?: boolean }) => Promise<void>

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
const LAYOUT_KEY = 'open-claude.layout'

function loadLayout(): { sidebarWidth: number; previewWidth: number; terminalHeight: number } {
  const fallback = { sidebarWidth: 280, previewWidth: 440, terminalHeight: 260 }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
  } catch {
    return fallback
  }
}

export const useStore = create<State>((set, get) => ({
  workspace: null,
  toasts: [],
  tree: {},
  expanded: new Set(),
  openFiles: [],
  activePath: null,
  dirty: new Set(),
  externalEdit: null,
  revealLine: null,
  sidebar: 'explorer',
  sidebarVisible: true,
  previewVisible: true,
  terminalVisible: true,
  ...loadLayout(),
  quickOpen: false,
  git: null,
  diffPath: null,
  terminals: [],
  activeTerminal: null,
  autoCheck: localStorage.getItem(AUTO_CHECK_KEY) !== 'off',
  threads: [],
  selectedThread: null,
  newThreadOpen: false,
  notifySettings: null,
  notificationLog: [],
  settingsOpen: false,
  guideOpen: false,
  systemCheck: null,
  ports: [],
  previewUrl: '',
  previewAttached: false,
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

  openFile: async (path, line) => {
    const reveal = line ? { path, line, at: Date.now() } : null
    set({ diffPath: null })

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
  setSidebar: (view) =>
    set((s) =>
      s.sidebar === view && s.sidebarVisible
        ? { sidebarVisible: false }
        : { sidebar: view, sidebarVisible: true }
    ),

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
    const value =
      panel === 'terminal'
        ? clamp(px, 80, window.innerHeight - 200)
        : clamp(px, 160, window.innerWidth - 400)

    set({ [key]: value } as Partial<State>)
    const { sidebarWidth, previewWidth, terminalHeight } = get()
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarWidth, previewWidth, terminalHeight }))
  },

  setQuickOpen: (quickOpen) => set({ quickOpen }),
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

  // -- terminals ------------------------------------------------------------

  addTerminal: (kind, opts = {}) => {
    const id = nextTerminalId()
    const sameKind = get().terminals.filter((t) => t.kind === kind).length
    const tab: TerminalTab = {
      id,
      kind,
      // "claude", "claude 2", "claude 3"… so tabs stay tellable apart at a glance.
      title: opts.title ?? (sameKind === 0 ? kind : `${kind} ${sameKind + 1}`),
      sessionId: null,
      exitCode: null,
      prompt: opts.prompt
    }
    set((s) => ({ terminals: [...s.terminals, tab], activeTerminal: id, terminalVisible: true }))
    return id
  },

  closeTerminal: (id) => {
    const tab = get().terminals.find((t) => t.id === id)
    if (tab?.sessionId) void call('terminal:kill', tab.sessionId)

    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id)
      // Focus the neighbour rather than blanking the panel.
      const activeTerminal =
        s.activeTerminal === id ? (terminals.at(-1)?.id ?? null) : s.activeTerminal
      return { terminals, activeTerminal }
    })
  },

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

  // -- threads --------------------------------------------------------------

  setNewThreadOpen: (newThreadOpen) => set({ newThreadOpen }),

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

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setGuideOpen: (guideOpen) => set({ guideOpen }),

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
    window.api.on('preview:elementPicked', (element) =>
      useStore.setState({ pickedElement: element, inspecting: false })
    ),

    window.api.on('adapt:fired', (adaptation) =>
      useStore.getState().triggerAdaptation(adaptation.skill)
    ),

    window.api.on('git:changed', (git) => useStore.setState({ git })),
    window.api.on('ports:changed', (ports) => useStore.setState({ ports })),
    window.api.on('app:error', (message) => useStore.getState().setError(message))
  ]

  return () => unsubscribers.forEach((off) => off())
}
