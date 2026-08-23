import type { ICONS } from '../components/Icon'
import type { useStore } from './store'

type State = ReturnType<typeof useStore.getState>

export interface Command {
  id: string
  title: string
  section: 'Agent' | 'Go to' | 'Preview' | 'Source control' | 'View' | 'Settings'
  keywords: string[]
  icon: keyof typeof ICONS
  shortcut?: string
  /** Whether this command should currently appear/be enabled at all. */
  when: (s: State) => boolean
  /** Shown in place of the command when `when` returns false and the command should
   *  still be visible but explain why it can't run, rather than just vanishing. */
  blockedBy?: (s: State) => string | null
  run: (s: State) => void | Promise<void>
}

const registry = new Map<string, Command>()

export function registerCommand(command: Command): void {
  if (registry.has(command.id)) {
    // Fail loudly in dev rather than silently letting a second registration win — a
    // duplicate id is exactly the bug this registry exists to prevent.
    console.error(`Command "${command.id}" is already registered.`)
    return
  }
  registry.set(command.id, command)
}

export function allCommands(): Command[] {
  return Array.from(registry.values())
}

/** Look one up by id, e.g. to render it as a menu item that reads from the same
 *  source as the palette rather than duplicating its label. */
export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

/** Every command that should render right now, blocked ones included. */
export function commandsFor(state: State): Array<Command & { blocked: string | null }> {
  return allCommands()
    .filter((c) => c.when(state) || c.blockedBy)
    .map((c) => ({ ...c, blocked: c.when(state) ? null : (c.blockedBy?.(state) ?? null) }))
}

const noWorkspace = 'Open a folder first'

// -- Go to --------------------------------------------------------------------

registerCommand({
  id: 'goto.line',
  title: 'Go to Line…',
  section: 'Go to',
  keywords: ['line', 'jump', 'goto'],
  icon: 'gotoLine',
  when: (s) => s.activePath !== null,
  blockedBy: (s) => (s.activePath === null ? 'Open a file first' : null),
  // Intercepted by CommandPalette before this runs — selecting the row switches the
  // palette into `:` mode rather than doing anything itself. Kept as a real command so
  // it appears in `>` search and carries a `when`/`blockedBy` like every other row.
  run: () => {}
})

// goto.symbol: skipped. Monaco has a built-in outline provider and
// `editor.action.quickOutline`, but reaching the live editor instance from outside
// EditorPane.tsx needs the same kind of ref-lifting `preview.reload` needed — out of
// scope for this batch. Noted in PROGRESS.md rather than built halfway.

// -- Agent ----------------------------------------------------------------------

registerCommand({
  id: 'session.new.claude',
  title: 'Claude session',
  section: 'Agent',
  keywords: ['terminal', 'claude', 'new', 'session'],
  icon: 'claude',
  shortcut: '⌘⇧N',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => {
    s.addTerminal('claude')
  }
})

registerCommand({
  id: 'agents.newSession',
  title: 'New Session…',
  section: 'Agent',
  keywords: ['session', 'new', 'worktree', 'subagent', 'branch'],
  icon: 'add',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.setNewThreadOpen(true)
})

registerCommand({
  id: 'session.new.worktree',
  title: 'Claude session on a new branch',
  section: 'Agent',
  keywords: ['terminal', 'claude', 'new', 'session', 'worktree', 'branch', 'git', 'instance'],
  icon: 'branch',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.openNewThreadAs('instance')
})

registerCommand({
  id: 'session.new.shell',
  title: 'Shell',
  section: 'Agent',
  keywords: ['terminal', 'shell', 'new', 'session'],
  icon: 'sessions',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => {
    s.addTerminal('shell')
  }
})

registerCommand({
  id: 'session.close',
  title: 'Close Session',
  section: 'Agent',
  keywords: ['close', 'session', 'terminal', 'end'],
  icon: 'close',
  shortcut: '⌘W',
  when: (s) => s.activeTerminal !== null,
  blockedBy: (s) => (s.activeTerminal === null ? 'No session is open' : null),
  run: (s) => s.requestCloseActiveTerminal()
})

registerCommand({
  id: 'agent.checkProject',
  title: 'Session that checks this project',
  section: 'Agent',
  keywords: ['check', 'project', 'audit', 'walk'],
  icon: 'check',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.runProjectCheck()
})

registerCommand({
  id: 'agent.testUi',
  title: 'Session that tests every screen',
  section: 'Agent',
  keywords: ['test', 'ui', 'audit', 'preview'],
  icon: 'agents',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.runUiAudit()
})

// -- Preview ----------------------------------------------------------------------

registerCommand({
  id: 'preview.pointAtElement',
  title: 'Point at It',
  section: 'Preview',
  keywords: ['select', 'inspect', 'element', 'pick', 'point'],
  icon: 'pointAtElement',
  // ⌘⇧C now opens the Claude rail item (batch 11); this is the next free shift-combo.
  shortcut: '⌘⇧P',
  when: (s) => s.previewUrl !== '',
  blockedBy: (s) => (s.previewUrl === '' ? 'Load a page in the preview first' : null),
  run: (s) => void (s.inspecting ? s.stopInspect() : s.startInspect())
})

registerCommand({
  id: 'preview.reload',
  title: 'Reload Preview',
  section: 'Preview',
  keywords: ['reload', 'refresh', 'preview'],
  icon: 'reload',
  when: (s) => s.previewUrl !== '',
  blockedBy: (s) => (s.previewUrl === '' ? 'Nothing loaded in the preview' : null),
  run: (s) => s.requestPreviewReload()
})

// -- Source control -----------------------------------------------------------------

registerCommand({
  id: 'git.showChanges',
  title: 'Show Changes',
  section: 'Source control',
  keywords: ['git', 'diff', 'changes', 'source', 'control'],
  icon: 'git',
  when: (s) => s.workspace?.isGitRepo === true,
  blockedBy: (s) => (s.workspace?.isGitRepo !== true ? 'This folder is not a git repository' : null),
  run: (s) => s.setSidebar('git')
})

// -- View -----------------------------------------------------------------------

registerCommand({
  id: 'view.toggleSidebar',
  title: 'Toggle Sidebar',
  section: 'View',
  keywords: ['sidebar', 'panel', 'toggle', 'view'],
  icon: 'sidebar',
  when: () => true,
  run: (s) => s.togglePanel('sidebar')
})

registerCommand({
  id: 'view.toggleTerminal',
  title: 'Toggle Terminal Panel',
  section: 'View',
  keywords: ['terminal', 'panel', 'toggle', 'view', 'sessions'],
  icon: 'terminalPanel',
  when: () => true,
  run: (s) => s.togglePanel('terminal')
})

registerCommand({
  id: 'view.togglePreview',
  title: 'Toggle Preview Panel',
  section: 'View',
  keywords: ['preview', 'panel', 'toggle', 'view', 'browser'],
  icon: 'previewPanel',
  shortcut: '⌘⇧V',
  when: () => true,
  run: (s) => s.togglePanel('preview')
})

registerCommand({
  id: 'view.claude',
  title: 'Claude',
  section: 'View',
  keywords: ['claude', 'usage', 'model', 'skills', 'plugins'],
  icon: 'claude',
  shortcut: '⌘⇧C',
  when: () => true,
  run: (s) => s.setSidebar('claude')
})

registerCommand({
  id: 'view.quickOpen',
  title: 'Go to File…',
  section: 'View',
  keywords: ['file', 'open', 'find', 'quick'],
  icon: 'files',
  shortcut: '⌘P',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.setQuickOpen(true)
})

// -- Explorer (closes D3) ------------------------------------------------------------

registerCommand({
  id: 'explorer.newFile',
  title: 'New File',
  section: 'View',
  keywords: ['new', 'file', 'create', 'explorer'],
  icon: 'add',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => {
    s.showSidebar('explorer')
    s.requestNewEntry('', false)
  }
})

registerCommand({
  id: 'explorer.newFolder',
  title: 'New Folder',
  section: 'View',
  keywords: ['new', 'folder', 'create', 'explorer', 'directory'],
  icon: 'folderAdd',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => {
    s.showSidebar('explorer')
    s.requestNewEntry('', true)
  }
})

registerCommand({
  id: 'view.refreshExplorer',
  title: 'Refresh Explorer',
  section: 'View',
  keywords: ['refresh', 'reload', 'explorer', 'tree'],
  icon: 'reload',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => void s.loadDir('')
})

registerCommand({
  id: 'explorer.collapseAll',
  title: 'Collapse All',
  section: 'View',
  keywords: ['collapse', 'explorer', 'tree', 'fold'],
  icon: 'collapseAll',
  when: (s) => s.workspace !== null,
  blockedBy: (s) => (s.workspace === null ? noWorkspace : null),
  run: (s) => s.collapseAll()
})

registerCommand({
  id: 'search.clear',
  title: 'Clear Search',
  section: 'View',
  keywords: ['clear', 'search', 'reset'],
  icon: 'close',
  when: () => true,
  run: (s) => s.requestSearchClear()
})

registerCommand({
  id: 'explorer.openFolder',
  title: 'Open Folder…',
  section: 'View',
  keywords: ['open', 'folder', 'workspace', 'project'],
  icon: 'openFolder',
  shortcut: '⌘O',
  when: () => true,
  run: (s) => void s.openFolder()
})

// -- Settings -----------------------------------------------------------------------

registerCommand({
  id: 'settings.open',
  title: 'Open Settings',
  section: 'Settings',
  keywords: ['settings', 'preferences', 'theme', 'notifications', 'privacy'],
  icon: 'settings',
  shortcut: '⌘,',
  when: () => true,
  run: (s) => s.setSettingsOpen(true)
})
