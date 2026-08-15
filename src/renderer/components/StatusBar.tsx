import { useStore } from '../state/store'

/**
 * The bottom strip. Everything here was previously either unlabelled or invisible:
 * which branch you are on, how many changes are pending, whether Claude can drive the
 * preview, and the cursor position.
 */
export function StatusBar({
  cursor
}: {
  cursor: { line: number; column: number } | null
}): JSX.Element {
  const {
    workspace,
    git,
    ports,
    dirty,
    previewUrl,
    previewAttached,
    terminals,
    setSidebar,
    togglePanel,
    openFolder,
    runProjectCheck,
    runUiAudit,
    setSettingsOpen,
    setGuideOpen,
    notificationLog,
    update,
    installUpdate
  } = useStore()

  const changes = git?.files.length ?? 0
  const unsaved = dirty.size

  return (
    <footer className="status-bar">
      <button className="status-item" onClick={() => void openFolder()} title="Open a different folder">
        <span aria-hidden="true">📂</span>
        {workspace?.name ?? 'No folder'}
      </button>

      {workspace?.isGitRepo && git && (
        <button
          className="status-item"
          onClick={() => setSidebar('git')}
          title="Show source control"
        >
          <span aria-hidden="true">⑂</span>
          {git.detached ? 'detached HEAD' : (git.branch ?? '—')}
          {git.behind > 0 && <span className="status-count">↓{git.behind}</span>}
          {git.ahead > 0 && <span className="status-count">↑{git.ahead}</span>}
        </button>
      )}

      {workspace?.isGitRepo && changes > 0 && (
        <button className="status-item" onClick={() => setSidebar('git')} title="Show changed files">
          {changes} change{changes === 1 ? '' : 's'}
        </button>
      )}

      {unsaved > 0 && (
        <span className="status-item status-warn" title="Files with unsaved edits">
          {unsaved} unsaved
        </span>
      )}

      {workspace && (
        <button
          className="status-item"
          onClick={runProjectCheck}
          title="Start a Claude session that walks this project end to end and reports back (read-only)"
        >
          <span aria-hidden="true">✓</span>
          Check project
        </button>
      )}

      {workspace && (
        <button
          className="status-item"
          onClick={runUiAudit}
          title="Start a Claude session that walks every screen and flow in the preview and reports what is broken (read-only)"
        >
          <span aria-hidden="true">⌕</span>
          Test UI
        </button>
      )}

      <span className="status-spacer" />

      {cursor && (
        <span className="status-item" title="Cursor position">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}

      <button
        className="status-item"
        onClick={() => togglePanel('terminal')}
        title="Show terminals"
      >
        <span aria-hidden="true">▤</span>
        {terminals.length} terminal{terminals.length === 1 ? '' : 's'}
      </button>

      <button className="status-item" onClick={() => setSidebar('ports')} title="Show listening ports">
        <span aria-hidden="true">⚓</span>
        {ports.length} port{ports.length === 1 ? '' : 's'}
      </button>

      {/*
        Only when there is something to say. An update that is not there yet is not news,
        and a status bar that permanently reports "up to date" is a status bar nobody
        reads. A failed check stays quiet too: it belongs in settings, not in the way.
      */}
      {update?.status === 'ready' && (
        <button
          className="status-item status-ok"
          onClick={() => void installUpdate()}
          title={`Version ${update.version} is downloaded. Installing restarts the editor, which ends every terminal and Claude session.`}
        >
          <span aria-hidden="true">↑</span>
          Update ready
        </button>
      )}

      {update?.status === 'downloading' && (
        <span className="status-item" title={`Downloading version ${update.version ?? ''}`}>
          <span aria-hidden="true">↓</span>
          {update.percent ?? 0}%
        </span>
      )}

      <button className="status-item" onClick={() => setGuideOpen(true)} title="How to use this">
        <span aria-hidden="true">?</span>
        Guide
      </button>

      <button
        className="status-item"
        onClick={() => setSettingsOpen(true)}
        title={
          notificationLog.length > 0
            ? `Notification settings — last alert: ${notificationLog[0].title}`
            : 'Notification settings'
        }
      >
        <span aria-hidden="true">🔔</span>
        Alerts
        {notificationLog.length > 0 && <span className="status-count">{notificationLog.length}</span>}
      </button>

      <button
        className={`status-item${previewAttached ? ' status-ok' : ''}`}
        onClick={() => togglePanel('preview')}
        title={
          previewAttached
            ? `Claude can drive the preview (${previewUrl})`
            : 'Preview not attached — load a URL in the preview panel'
        }
      >
        <span aria-hidden="true">{previewAttached ? '●' : '○'}</span>
        Claude preview {previewAttached ? 'ready' : 'idle'}
      </button>
    </footer>
  )
}
