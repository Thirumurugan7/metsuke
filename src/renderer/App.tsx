import { useEffect } from 'react'
import { useStore, wireEvents, type SidebarView } from './state/store'
import { Explorer } from './components/Explorer'
import { GitPanel } from './components/GitPanel'
import { SearchPanel } from './components/SearchPanel'
import { EditorPane } from './components/EditorPane'
import { DiffView } from './components/DiffView'
import { Preview } from './components/Preview'
import { TerminalPanel } from './components/TerminalPanel'

const VIEWS: Array<{ id: SidebarView; icon: string; label: string }> = [
  { id: 'explorer', icon: '▤', label: 'Explorer' },
  { id: 'git', icon: '⑂', label: 'Source Control' },
  { id: 'search', icon: '⌕', label: 'Search' },
  { id: 'ports', icon: '⚓', label: 'Ports' }
]

export function App(): JSX.Element {
  const {
    workspace,
    error,
    sidebar,
    sidebarVisible,
    previewVisible,
    terminalVisible,
    git,
    diffPath,
    ports,
    setSidebar,
    togglePanel,
    setError,
    openFolder,
    setPreviewUrl
  } = useStore()

  useEffect(() => wireEvents(), [])

  // Reopen the last folder so the editor does not start empty every launch.
  useEffect(() => {
    void useStore.getState().restoreLastFolder()
  }, [])

  const changeCount = git?.files.length ?? 0

  return (
    <div className="app">
      <div className="title-bar">
        <span className="title-name">{workspace?.name ?? 'No folder open'}</span>
        {workspace?.isGitRepo && git && (
          <span className="title-git">
            ⑂ {git.detached ? 'detached' : git.branch}
            {git.ahead > 0 && ` ↑${git.ahead}`}
            {git.behind > 0 && ` ↓${git.behind}`}
            {changeCount > 0 && <span className="title-changes">● {changeCount}</span>}
          </span>
        )}
        <div className="title-actions">
          <button onClick={() => void openFolder()}>Open Folder</button>
          <button className={sidebarVisible ? 'active' : ''} onClick={() => togglePanel('sidebar')}>
            ▤
          </button>
          <button className={previewVisible ? 'active' : ''} onClick={() => togglePanel('preview')}>
            ◫
          </button>
          <button className={terminalVisible ? 'active' : ''} onClick={() => togglePanel('terminal')}>
            ⌘
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="body">
        <div className="activity-bar">
          {VIEWS.map((view) => (
            <button
              key={view.id}
              className={sidebar === view.id && sidebarVisible ? 'active' : ''}
              title={view.label}
              onClick={() => setSidebar(view.id)}
            >
              {view.icon}
              {view.id === 'git' && changeCount > 0 && <span className="dot">{changeCount}</span>}
              {view.id === 'ports' && ports.length > 0 && <span className="dot">{ports.length}</span>}
            </button>
          ))}
        </div>

        {sidebarVisible && (
          <div className="sidebar">
            <div className="sidebar-header">{VIEWS.find((v) => v.id === sidebar)?.label}</div>
            <div className="sidebar-body">
              {sidebar === 'explorer' && <Explorer />}
              {sidebar === 'git' && <GitPanel />}
              {sidebar === 'search' && <SearchPanel />}
              {sidebar === 'ports' && (
                <div className="ports-sidebar">
                  {ports.length === 0 && <div className="panel-empty">No servers listening</div>}
                  {ports.map((port) => (
                    <div
                      key={port.port}
                      className={`port-row${port.ours ? ' ours' : ''}`}
                      onClick={() => setPreviewUrl(`http://localhost:${port.port}`)}
                    >
                      <span className="port-number">{port.port}</span>
                      <span className="port-process">{port.process ?? 'unknown'}</span>
                      {port.ours && <span className="port-badge">started here</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="main">
          <div className="center">
            {diffPath ? <DiffView path={diffPath} /> : <EditorPane />}
            {terminalVisible && <TerminalPanel />}
          </div>
          {previewVisible && <Preview />}
        </div>
      </div>
    </div>
  )
}
