import { useStore } from '../state/store'
import { Icon } from './Icon'
import { AgentStatusChip } from './AgentStatusChip'

/**
 * The bottom strip: three groups, thin separators between them. Left is project truth
 * (mostly non-interactive), centre is an empty spacer, right is system-level state,
 * led by the agent status chip. Everything here duplicates nothing else in the chrome —
 * the title bar owns the project switcher and layout toggles, the rail owns navigation.
 */
export function StatusBar({
  cursor
}: {
  cursor: { line: number; column: number } | null
}): JSX.Element {
  const { git, dirty, terminals, setSidebar, togglePanel, setSettingsOpen, notificationLog, update, installUpdate } =
    useStore()

  const changes = git?.files.length ?? 0
  const unsaved = dirty.size

  return (
    <footer className="status-bar">
      <div className="status-group">
        {git && (
          <button className="status-item" onClick={() => setSidebar('git')} title="Show source control">
            <Icon name="branch" />
            {git.detached ? 'detached HEAD' : (git.branch ?? '—')}
            {git.behind > 0 && <span className="status-count">↓{git.behind}</span>}
            {git.ahead > 0 && <span className="status-count">↑{git.ahead}</span>}
          </button>
        )}

        {changes > 0 && (
          <button className="status-item" onClick={() => setSidebar('git')} title="Show changed files">
            {changes} change{changes === 1 ? '' : 's'}
          </button>
        )}

        {unsaved > 0 && (
          <span className="status-item status-warn" title="Files with unsaved edits">
            {unsaved} unsaved
          </span>
        )}

        {cursor && (
          <span className="status-item" title="Cursor position">
            Ln {cursor.line}, Col {cursor.column}
          </span>
        )}
      </div>

      <span className="status-sep" />

      <div className="status-group status-group-agent" />

      <span className="status-sep" />

      <div className="status-group">
        <AgentStatusChip />

        <button className="status-item" onClick={() => togglePanel('terminal')} title="Show sessions">
          <Icon name="terminalPanel" />
          {terminals.length} session{terminals.length === 1 ? '' : 's'}
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
            title={`Version ${update.version} is downloaded. Installing restarts the editor, which ends every session.`}
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

        <button
          className="status-item icon-only"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <Icon name="settings" />
          {notificationLog.length > 0 && <span className="status-count">{notificationLog.length}</span>}
        </button>
      </div>
    </footer>
  )
}
