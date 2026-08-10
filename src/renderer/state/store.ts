import { create } from 'zustand'
import type {
  DirEntry,
  GitStatus,
  InvokeChannel,
  InvokeChannels,
  PortInfo,
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
async function adopt(workspace: Workspace): Promise<void> {
  localStorage.setItem(LAST_FOLDER_KEY, workspace.root)
  useStore.setState({
    workspace,
    tree: {},
    expanded: new Set(),
    openFiles: [],
    activePath: null,
    dirty: new Set(),
    externalEdit: null,
    git: null,
    diffPath: null
  })
  await useStore.getState().loadDir('')
  await useStore.getState().refreshGit()
}

export type SidebarView = 'explorer' | 'git' | 'search' | 'ports'

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

  // -- preview --------------------------------------------------------------
  ports: PortInfo[]
  previewUrl: string
  /** True once the CDP debugger is attached, i.e. Claude can drive the page. */
  previewAttached: boolean

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
  ports: [],
  previewUrl: '',
  previewAttached: false,

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
    const workspace = await call('workspace:open')
    if (!workspace) return
    await adopt(workspace)
  },

  restoreLastFolder: async () => {
    const last = localStorage.getItem(LAST_FOLDER_KEY)
    if (!last) return

    // The folder may have been moved or deleted since last launch. That is not worth
    // an error banner on startup — just forget it and open empty.
    const result = await window.api.invoke('workspace:openPath', last)
    if (!result.ok) {
      localStorage.removeItem(LAST_FOLDER_KEY)
      return
    }
    await adopt(result.value)
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

  showInPreview: (previewUrl) => set({ previewUrl, previewVisible: true }),
  setPreviewUrl: (previewUrl) => set({ previewUrl })
}))

/** Subscribe to the main process's push events. Called once at startup. */
export function wireEvents(): () => void {
  const unsubscribers = [
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

    window.api.on('git:changed', (git) => useStore.setState({ git })),
    window.api.on('ports:changed', (ports) => useStore.setState({ ports })),
    window.api.on('app:error', (message) => useStore.getState().setError(message))
  ]

  return () => unsubscribers.forEach((off) => off())
}
