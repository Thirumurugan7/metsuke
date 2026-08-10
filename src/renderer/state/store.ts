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

const LAST_FOLDER_KEY = 'codeeditor.lastFolder'

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

interface State {
  workspace: Workspace | null
  error: string | null

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

  // -- panels ---------------------------------------------------------------
  sidebar: SidebarView
  sidebarVisible: boolean
  previewVisible: boolean
  terminalVisible: boolean

  // -- git ------------------------------------------------------------------
  git: GitStatus | null
  /** Path whose diff is showing in the editor area, if any. */
  diffPath: string | null

  // -- preview --------------------------------------------------------------
  ports: PortInfo[]
  previewUrl: string

  setError: (error: string | null) => void
  openFolder: () => Promise<void>
  restoreLastFolder: () => Promise<void>
  loadDir: (dir: string) => Promise<void>
  toggleDir: (dir: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeFile: (path: string) => void
  markDirty: (path: string, isDirty: boolean) => void
  saveFile: (path: string, contents: string) => Promise<void>
  refreshGit: () => Promise<void>
  showDiff: (path: string | null) => void
  setSidebar: (view: SidebarView) => void
  togglePanel: (panel: 'sidebar' | 'preview' | 'terminal') => void
  setPreviewUrl: (url: string) => void
}

export const useStore = create<State>((set, get) => ({
  workspace: null,
  error: null,
  tree: {},
  expanded: new Set(),
  openFiles: [],
  activePath: null,
  dirty: new Set(),
  externalEdit: null,
  sidebar: 'explorer',
  sidebarVisible: true,
  previewVisible: true,
  terminalVisible: true,
  git: null,
  diffPath: null,
  ports: [],
  previewUrl: '',

  setError: (error) => set({ error }),

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

  openFile: async (path) => {
    set({ diffPath: null })

    if (get().openFiles.some((f) => f.path === path)) {
      set({ activePath: path })
      return
    }

    const contents = await call('files:read', path)
    if (contents === null) return
    set((s) => ({
      openFiles: [...s.openFiles, { path, saved: contents }],
      activePath: path
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
  setSidebar: (sidebar) => set({ sidebar, sidebarVisible: true }),

  togglePanel: (panel) =>
    set((s) => {
      if (panel === 'sidebar') return { sidebarVisible: !s.sidebarVisible }
      if (panel === 'preview') return { previewVisible: !s.previewVisible }
      return { terminalVisible: !s.terminalVisible }
    }),

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
