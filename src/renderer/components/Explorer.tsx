import { useStore } from '../state/store'
import type { DirEntry, GitStatus } from '@shared/ipc'

/**
 * Single-letter badge matching the git status of a file, VS Code style. Takes the
 * status as an argument rather than reading the store, so the caller's subscription
 * drives repaints.
 */
function statusBadge(path: string, git: GitStatus | null): { letter: string; className: string } | null {
  const file = git?.files.find((f) => f.path === path)
  if (!file) return null

  const state = file.unstaged !== 'unchanged' ? file.unstaged : file.staged
  switch (state) {
    case 'untracked':
      return { letter: 'U', className: 'badge-untracked' }
    case 'added':
      return { letter: 'A', className: 'badge-added' }
    case 'deleted':
      return { letter: 'D', className: 'badge-deleted' }
    case 'conflicted':
      return { letter: '!', className: 'badge-conflict' }
    case 'modified':
    case 'renamed':
    case 'copied':
      return { letter: 'M', className: 'badge-modified' }
    default:
      return null
  }
}

function Row({ entry, depth }: { entry: DirEntry; depth: number }): JSX.Element {
  const { expanded, tree, activePath, git, toggleDir, openFile } = useStore()
  const isOpen = expanded.has(entry.path)
  const badge = statusBadge(entry.path, git)

  return (
    <>
      <div
        className={`tree-row${activePath === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => (entry.isDirectory ? void toggleDir(entry.path) : void openFile(entry.path))}
        title={entry.path}
      >
        <span className="tree-caret">{entry.isDirectory ? (isOpen ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{entry.isDirectory ? '📁' : '📄'}</span>
        <span className="tree-name">{entry.name}</span>
        {badge && <span className={`tree-badge ${badge.className}`}>{badge.letter}</span>}
      </div>

      {entry.isDirectory &&
        isOpen &&
        (tree[entry.path] ?? []).map((child) => (
          <Row key={child.path} entry={child} depth={depth + 1} />
        ))}
    </>
  )
}

export function Explorer(): JSX.Element {
  const { workspace, tree, openFolder } = useStore()

  if (!workspace) {
    return (
      <div className="panel-empty">
        <p>No folder open</p>
        <button onClick={() => void openFolder()}>Open Folder</button>
      </div>
    )
  }

  return (
    <div className="tree">
      {(tree[''] ?? []).map((entry) => (
        <Row key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  )
}
