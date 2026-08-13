import { useEffect, useRef, useState } from 'react'
import { useStore, wireEvents, type SidebarView } from './state/store'
import { Explorer } from './components/Explorer'
import { GitPanel } from './components/GitPanel'
import { SearchPanel } from './components/SearchPanel'
import { PortsPanel } from './components/PortsPanel'
import { ClaudePanel } from './components/ClaudePanel'
import { ThreadsPanel } from './components/ThreadsPanel'
import { NewThread } from './components/NewThread'
import { LandThread } from './components/LandThread'
import { EditorPane } from './components/EditorPane'
import { Preview } from './components/Preview'
import { TerminalPanel } from './components/TerminalPanel'
import { StatusBar } from './components/StatusBar'
import { Splitter } from './components/Splitter'
import { QuickOpen } from './components/QuickOpen'
import { Toasts } from './components/Toasts'
import { ElementComment } from './components/ElementComment'
import { Welcome } from './components/Welcome'
import { Guide } from './components/Guide'
import { Adaptation } from './components/Adaptation'
import { NotificationSettings } from './components/NotificationSettings'

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'

/** `label` is the panel heading; `short` is the one-word caption under the icon. */
const VIEWS: Array<{
  id: SidebarView
  icon: string
  label: string
  short: string
  shortcut: string
}> = [
  { id: 'explorer', icon: '▤', label: 'Explorer', short: 'Files', shortcut: `${MOD}⇧E` },
  { id: 'git', icon: '⑂', label: 'Source Control', short: 'Git', shortcut: `${MOD}⇧G` },
  { id: 'search', icon: '⌕', label: 'Search', short: 'Search', shortcut: `${MOD}⇧F` },
  { id: 'ports', icon: '⚓', label: 'Ports', short: 'Ports', shortcut: `${MOD}⇧P` },
  { id: 'threads', icon: '◆', label: 'Threads', short: 'Threads', shortcut: `${MOD}⇧T` },
  { id: 'claude', icon: '✳', label: 'Claude', short: 'Claude', shortcut: `${MOD}⇧C` }
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
    git,
    ports,
    dirty,
    activePath,
    setSidebar,
    togglePanel,
    setPanelSize,
    setQuickOpen,
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
  }, [])

  // Keep the OS window title in step, with the standard dirty marker.
  useEffect(() => {
    const name = workspace?.name
    document.title = name
      ? `${dirty.size > 0 ? '● ' : ''}${activePath?.split('/').pop() ?? name} — Open Claude`
      : 'Open Claude'
  }, [workspace, activePath, dirty])

  // Global shortcuts. Registered on the window rather than inside Monaco so they work
  // no matter which panel has focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const key = e.key.toLowerCase()
      if (e.shiftKey) {
        const view = ({
          e: 'explorer',
          g: 'git',
          f: 'search',
          p: 'ports',
          t: 'threads',
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
      } else if (key === 'b') {
        e.preventDefault()
        togglePanel('sidebar')
      } else if (key === 'j') {
        e.preventDefault()
        togglePanel('terminal')
      } else if (key === 'w') {
        e.preventDefault()
        if (useStore.getState().activePath) closeFile(useStore.getState().activePath!)
      } else if (key === 'o') {
        e.preventDefault()
        void openFolder()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setSidebar, setQuickOpen, togglePanel, closeFile, openFolder])

  const changes = git?.files.length ?? 0
  const activeView = VIEWS.find((v) => v.id === sidebar)

  return (
    <div className="app">
      <header className="title-bar">
        <span className="app-name">Open Claude</span>
        <span className="title-sep" />
        <span className="title-folder">{workspace?.name ?? 'No folder open'}</span>

        <div className="title-actions">
          <button className="labelled" onClick={() => void openFolder()} title={`Open folder (${MOD}O)`}>
            <span aria-hidden="true">📂</span> Open Folder
          </button>
          <button
            className={`labelled${sidebarVisible ? ' active' : ''}`}
            onClick={() => togglePanel('sidebar')}
            title={`Toggle sidebar (${MOD}B)`}
          >
            <span aria-hidden="true">▤</span> Sidebar
          </button>
          <button
            className={`labelled${previewVisible ? ' active' : ''}`}
            onClick={() => togglePanel('preview')}
            title="Toggle preview panel"
          >
            <span aria-hidden="true">◫</span> Preview
          </button>
          <button
            className={`labelled${terminalVisible ? ' active' : ''}`}
            onClick={() => togglePanel('terminal')}
            title={`Toggle terminal (${MOD}J)`}
          >
            <span aria-hidden="true">▤</span> Terminal
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
              <span className="activity-icon" aria-hidden="true">
                {view.icon}
              </span>
              <span className="activity-label">{view.short}</span>
              {view.id === 'git' && changes > 0 && <span className="dot">{changes}</span>}
              {view.id === 'ports' && ports.length > 0 && <span className="dot">{ports.length}</span>}
            </button>
          ))}
        </nav>

        {sidebarVisible && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth }} aria-label={activeView?.label}>
              <div className="sidebar-header">
                <span>{activeView?.label}</span>
                <button
                  className="icon-only"
                  title="Hide sidebar"
                  aria-label="Hide sidebar"
                  onClick={() => togglePanel('sidebar')}
                >
                  ×
                </button>
              </div>
              <div className="sidebar-body">
                {sidebar === 'explorer' && <Explorer />}
                {sidebar === 'git' && <GitPanel />}
                {sidebar === 'search' && <SearchPanel />}
                {sidebar === 'ports' && <PortsPanel />}
                {sidebar === 'threads' && <ThreadsPanel />}
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
                label="Resize terminal"
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
      <Guide />
      <ElementComment />
      <QuickOpen />
      <NewThread />
      <LandThread />
      <NotificationSettings />
      <Toasts />
    </div>
  )
}
