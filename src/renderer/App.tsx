import { useEffect, useRef, useState } from 'react'
import { useStore, wireEvents, type SidebarView } from './state/store'
import { Explorer, ExplorerActions } from './components/Explorer'
import { GitPanel, GitPanelActions } from './components/GitPanel'
import { SearchPanel, SearchActions } from './components/SearchPanel'
import { ThreadsPanel, ThreadsActions } from './components/ThreadsPanel'
import { ClaudePanel, ClaudePanelActions } from './components/ClaudePanel'
import { NewThread } from './components/NewThread'
import { LandThread } from './components/LandThread'
import { EditorPane } from './components/EditorPane'
import { Preview } from './components/Preview'
import { TerminalPanel } from './components/TerminalPanel'
import { StatusBar } from './components/StatusBar'
import { Splitter } from './components/Splitter'
import { CommandPalette } from './components/CommandPalette'
import { Toasts } from './components/Toasts'
import { ElementComment } from './components/ElementComment'
import { Welcome } from './components/Welcome'
import { Guide } from './components/Guide'
import { Adaptation } from './components/Adaptation'
import { Settings } from './components/Settings'
import { TelemetryConsent } from './components/TelemetryConsent'
import { Icon, ICONS } from './components/Icon'
import { getCommand } from './state/commands'

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'

/** `label` is the panel heading; `short` is the one-word caption under the icon. */
const VIEWS: Array<{
  id: SidebarView
  icon: keyof typeof ICONS
  label: string
  short: string
  shortcut: string
}> = [
  { id: 'explorer', icon: 'files', label: 'Explorer', short: 'Explorer', shortcut: `${MOD}⇧E` },
  { id: 'git', icon: 'git', label: 'Source Control', short: 'Git', shortcut: `${MOD}⇧G` },
  { id: 'search', icon: 'search', label: 'Search', short: 'Search', shortcut: `${MOD}⇧F` },
  { id: 'agents', icon: 'agents', label: 'Agents', short: 'Agents', shortcut: `${MOD}⇧A` },
  // Claude used to be a second tab inside Agents. Its own panel (usage, model, skills,
  // plugins) earned a rail item of its own — this deliberately reopens C5/A3's "four
  // items" count to five (batch 11).
  { id: 'claude', icon: 'claude', label: 'Claude', short: 'Claude', shortcut: `${MOD}⇧C` }
]

export function App(): JSX.Element {
  const {
    workspace,
    sidebar,
    sidebarVisible,
    previewVisible,
    terminalVisible,
    sidebarWidth,
    previewWidth,
    terminalHeight,
    previewFullscreen,
    inspecting,
    git,
    dirty,
    activePath,
    setSidebar,
    togglePanel,
    setPanelSize,
    setQuickOpen,
    setPaletteOpen,
    openFolder,
    closeFile
  } = useStore()

  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null)

  /*
   * Panel sizes are derived from real geometry rather than hardcoded offsets. The
   * sidebar used to be computed as `x - 48` for the activity bar, which silently went
   * 20px wrong the moment that bar grew to 68px to fit its labels.
   */
  const bodyRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<HTMLElement>(null)

  const resizeSidebar = (x: number): void =>
    setPanelSize('sidebar', x - (activityRef.current?.getBoundingClientRect().right ?? 0))

  const resizeTerminal = (y: number): void =>
    setPanelSize('terminal', (bodyRef.current?.getBoundingClientRect().bottom ?? window.innerHeight) - y)

  const resizePreview = (x: number): void =>
    setPanelSize('preview', (bodyRef.current?.getBoundingClientRect().right ?? window.innerWidth) - x)

  useEffect(() => wireEvents(), [])
  useEffect(() => {
    void useStore.getState().restoreLastFolder()
    // Loaded up front so a notification arriving before the settings panel is ever
    // opened still knows which channels the user wants.
    void useStore.getState().loadNotifySettings()
    // Whether an update is already waiting from a previous run, and whether checking is
    // even on. Until this answers, the status bar says nothing about updates at all.
    void window.api
      .invoke('updates:get')
      .then((result) => result.ok && useStore.setState({ update: result.value }))
    // Consent state, which decides whether the welcome screen asks the question.
    void window.api
      .invoke('telemetry:get')
      .then((result) => result.ok && useStore.setState({ telemetry: result.value }))
  }, [])

  // Keep the OS window title in step, with the standard dirty marker.
  useEffect(() => {
    const name = workspace?.name
    document.title = name
      ? `${dirty.size > 0 ? '● ' : ''}${activePath?.split('/').pop() ?? name} — Metsuke`
      : 'Metsuke'
  }, [workspace, activePath, dirty])

  // Global shortcuts. Registered on the window rather than inside Monaco so they work
  // no matter which panel has focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const key = e.key.toLowerCase()
      if (e.shiftKey) {
        if (key === 'n') {
          e.preventDefault()
          if (useStore.getState().workspace) useStore.getState().addTerminal('claude')
          return
        }
        if (key === 'p') {
          const cmd = getCommand('preview.pointAtElement')
          const s = useStore.getState()
          if (cmd?.when(s)) {
            e.preventDefault()
            void cmd.run(s)
          }
          return
        }
        if (key === 'v') {
          e.preventDefault()
          togglePanel('preview')
          return
        }
        const view = ({
          e: 'explorer',
          g: 'git',
          f: 'search',
          a: 'agents',
          c: 'claude'
        } as const)[key]
        if (view) {
          e.preventDefault()
          setSidebar(view)
        }
        return
      }

      if (key === 'p') {
        e.preventDefault()
        setQuickOpen(true)
      } else if (key === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (key === 'b') {
        e.preventDefault()
        togglePanel('sidebar')
      } else if (key === 'j') {
        e.preventDefault()
        togglePanel('terminal')
      } else if (key === 'w') {
        e.preventDefault()
        const s = useStore.getState()
        const inSessions = document.activeElement?.closest('.terminal-panel') !== null
        if (inSessions && s.activeTerminal) s.requestCloseActiveTerminal()
        else if (s.activePath) closeFile(s.activePath)
      } else if (key === 'o') {
        e.preventDefault()
        void openFolder()
      } else if (key === ',') {
        e.preventDefault()
        useStore.getState().setSettingsOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setSidebar, setQuickOpen, setPaletteOpen, togglePanel, closeFile, openFolder])

  const changes = git?.files.length ?? 0
  const activeView = VIEWS.find((v) => v.id === sidebar)

  return (
    <div className={`app${inspecting ? ' inspecting-mode' : ''}`}>
      <header className="title-bar">
        <span className="app-name">Metsuke</span>
        <span className="title-sep" />

        <button
          className="project-switcher"
          onClick={() => void openFolder()}
          title={workspace ? `Switch folder (${MOD}O)` : `Open folder (${MOD}O)`}
        >
          <Icon name="openFolder" />
          <span className="project-name">{workspace?.name ?? 'No folder open'}</span>
          {workspace?.isGitRepo && git?.branch && (
            <span className="project-branch">
              <Icon name="branch" />
              {git.branch}
            </span>
          )}
        </button>

        {/* The chip lives in the status bar only now — centred here read as its own
            floating thing rather than part of either the project switcher or the
            layout control either side of it. Kept as a spacer so the layout control
            stays pinned to the right edge. */}
        <div className="title-agent-slot" />

        <div className="layout-control" role="group" aria-label="Layout">
          <button
            className={sidebarVisible ? 'active' : ''}
            onClick={() => togglePanel('sidebar')}
            title={`Toggle sidebar (${MOD}B)`}
            aria-pressed={sidebarVisible}
          >
            <Icon name="sidebar" />
          </button>
          <button
            className={previewVisible ? 'active' : ''}
            onClick={() => togglePanel('preview')}
            title={`Toggle preview panel (${MOD}⇧V)`}
            aria-pressed={previewVisible}
          >
            <Icon name="previewPanel" />
          </button>
          <button
            className={terminalVisible ? 'active' : ''}
            onClick={() => togglePanel('terminal')}
            title={`Toggle sessions (${MOD}J)`}
            aria-pressed={terminalVisible}
          >
            <Icon name="terminalPanel" />
          </button>
        </div>
      </header>

      <div className={`body${previewFullscreen ? ' preview-fullscreen' : ''}`} ref={bodyRef}>
        <nav className="activity-bar" aria-label="Views" ref={activityRef}>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              className={`activity-item${sidebar === view.id && sidebarVisible ? ' active' : ''}`}
              title={`${view.label} (${view.shortcut})`}
              aria-label={view.label}
              aria-pressed={sidebar === view.id && sidebarVisible}
              onClick={() => setSidebar(view.id)}
            >
              <span className="activity-icon">
                <Icon name={view.icon} size={20} />
              </span>
              <span className="activity-label">{view.short}</span>
              {view.id === 'git' && changes > 0 && <span className="dot">{changes}</span>}
            </button>
          ))}
        </nav>

        {sidebarVisible && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth }} aria-label={activeView?.label}>
              <div className="sidebar-header">
                <span className="panel-title">{activeView?.label}</span>
                <div className="panel-actions">
                  {sidebar === 'explorer' && <ExplorerActions />}
                  {sidebar === 'git' && <GitPanelActions />}
                  {sidebar === 'search' && <SearchActions />}
                  {sidebar === 'agents' && <ThreadsActions />}
                  {sidebar === 'claude' && <ClaudePanelActions />}
                </div>
                <span className="header-sep" aria-hidden="true" />
                {/* Same glyph as the rail's own hide affordance (D2) — one gesture, drawn
                    the same way in both places, rather than an unrelated × next to it. */}
                <button
                  className="icon-only"
                  title="Hide sidebar"
                  aria-label="Hide sidebar"
                  onClick={() => togglePanel('sidebar')}
                >
                  <Icon name="sidebar" />
                </button>
              </div>
              <div className="sidebar-body">
                {sidebar === 'explorer' && <Explorer />}
                {sidebar === 'git' && <GitPanel />}
                {sidebar === 'search' && <SearchPanel />}
                {sidebar === 'agents' && <ThreadsPanel />}
                {sidebar === 'claude' && <ClaudePanel />}
              </div>
            </aside>
            <Splitter
              orientation="vertical"
              label="Resize sidebar"
              onResize={resizeSidebar}
            />
          </>
        )}

        <main className="main">
          <div className="center">
            <div className="editor-region">
              <EditorPane onCursorChange={setCursor} />
              {!workspace && <Welcome />}
            </div>

            {/*
              Panels are hidden with CSS rather than unmounted. Unmounting the terminal
              tore down its pty — toggling the panel killed the running `claude` session
              and its scrollback. Same for the preview, which would drop its CDP
              attachment and reload the page.
            */}
            {terminalVisible && (
              <Splitter
                orientation="horizontal"
                label="Resize sessions"
                onResize={resizeTerminal}
              />
            )}
            <div
              className="terminal-slot"
              style={{ height: terminalVisible ? terminalHeight : 0 }}
              aria-hidden={!terminalVisible}
            >
              <TerminalPanel />
            </div>
          </div>

          {previewVisible && (
            <Splitter
              orientation="vertical"
              label="Resize preview"
              onResize={resizePreview}
            />
          )}
          <div
            className="preview-slot"
            style={{ width: previewVisible ? previewWidth : 0 }}
            aria-hidden={!previewVisible}
          >
            <Preview />
          </div>
        </main>
      </div>

      <StatusBar cursor={cursor} />
      <Adaptation />
      <TelemetryConsent />
      <Guide />
      <ElementComment />
      <CommandPalette />
      <NewThread />
      <LandThread />
      <Settings />
      <Toasts />
    </div>
  )
}
