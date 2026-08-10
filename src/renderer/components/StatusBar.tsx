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
    setSidebar,
    togglePanel,
    openFolder
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

      <span className="status-spacer" />

      {cursor && (
        <span className="status-item" title="Cursor position">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}

      <button className="status-item" onClick={() => setSidebar('ports')} title="Show listening ports">
        <span aria-hidden="true">⚓</span>
        {ports.length} port{ports.length === 1 ? '' : 's'}
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
