import { useEffect, useState } from 'react'
import { useStore, wireEvents, type SidebarView } from './state/store'
import { Explorer } from './components/Explorer'
import { GitPanel } from './components/GitPanel'
import { SearchPanel } from './components/SearchPanel'
import { PortsPanel } from './components/PortsPanel'
import { EditorPane } from './components/EditorPane'
import { Preview } from './components/Preview'
import { TerminalPanel } from './components/TerminalPanel'
import { StatusBar } from './components/StatusBar'
import { Splitter } from './components/Splitter'
import { QuickOpen } from './components/QuickOpen'
import { Toasts } from './components/Toasts'

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
  { id: 'ports', icon: '⚓', label: 'Ports', short: 'Ports', shortcut: `${MOD}⇧P` }
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

  useEffect(() => wireEvents(), [])
  useEffect(() => {
    void useStore.getState().restoreLastFolder()
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
        const view = ({ e: 'explorer', g: 'git', f: 'search', p: 'ports' } as const)[key]
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

      <div className="body">
        <nav className="activity-bar" aria-label="Views">
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
              </div>
            </aside>
            <Splitter
              orientation="vertical"
              label="Resize sidebar"
              onResize={(x) => setPanelSize('sidebar', x - 48)}
            />
          </>
        )}

        <main className="main">
          <div className="center">
            <EditorPane onCursorChange={setCursor} />

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
                onResize={(y) => setPanelSize('terminal', window.innerHeight - y - 22)}
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
              onResize={(x) => setPanelSize('preview', window.innerWidth - x)}
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
      <QuickOpen />
      <Toasts />
    </div>
  )
}
