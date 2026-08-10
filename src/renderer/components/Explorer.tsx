import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import type { DirEntry, GitStatus } from '@shared/ipc'

/**
 * Single-letter badge matching the git status of a file. Takes the status as an
 * argument rather than reading the store, so the caller's subscription drives repaints.
 */
function statusBadge(
  path: string,
  git: GitStatus | null
): { letter: string; className: string; label: string } | null {
  const file = git?.files.find((f) => f.path === path)
  if (!file) return null

  const state = file.unstaged !== 'unchanged' ? file.unstaged : file.staged
  switch (state) {
    case 'untracked':
      return { letter: 'U', className: 'badge-untracked', label: 'Untracked' }
    case 'added':
      return { letter: 'A', className: 'badge-added', label: 'Added' }
    case 'deleted':
      return { letter: 'D', className: 'badge-deleted', label: 'Deleted' }
    case 'conflicted':
      return { letter: '!', className: 'badge-conflict', label: 'Conflicted' }
    case 'modified':
    case 'renamed':
    case 'copied':
      return { letter: 'M', className: 'badge-modified', label: 'Modified' }
    default:
      return null
  }
}

interface MenuState {
  x: number
  y: number
  path: string
  isDirectory: boolean
}

/** A draft row for a file or folder being created, shown inline in the tree. */
interface Draft {
  parent: string
  isDirectory: boolean
}

export function Explorer(): JSX.Element {
  const { workspace, tree, openFolder, loadDir, refreshGit, setError } = useStore()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [menu])

  if (!workspace) {
    return (
      <div className="panel-empty">
        <p className="empty-title">No folder open</p>
        <p className="hint">Open a folder to see its files here.</p>
        <button className="primary" onClick={() => void openFolder()}>
          Open Folder
        </button>
      </div>
    )
  }

  const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/')

  const create = async (parent: string, name: string, isDirectory: boolean): Promise<void> => {
    setDraft(null)
    if (!name.trim()) return
    const path = parent ? `${parent}/${name}` : name
    if ((await call('files:create', path, isDirectory)) === null) return
    await loadDir(parent)
    await refreshGit()
    if (!isDirectory) void useStore.getState().openFile(path)
  }

  const rename = async (from: string, name: string): Promise<void> => {
    setRenaming(null)
    if (!name.trim() || name === from.split('/').pop()) return
    const parent = parentOf(from)
    const to = parent ? `${parent}/${name}` : name
    if ((await call('files:rename', from, to)) === null) return
    await loadDir(parent)
    await refreshGit()
  }

  const remove = async (path: string): Promise<void> => {
    setMenu(null)
    if (!confirm(`Delete ${path}? This cannot be undone.`)) return
    if ((await call('files:delete', path)) === null) return
    useStore.getState().closeFile(path)
    await loadDir(parentOf(path))
    await refreshGit()
  }

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <button
          className="icon-only"
          title="New file in the root folder"
          aria-label="New file"
          onClick={() => setDraft({ parent: '', isDirectory: false })}
        >
          ＋
        </button>
        <button
          className="icon-only"
          title="New folder in the root folder"
          aria-label="New folder"
          onClick={() => setDraft({ parent: '', isDirectory: true })}
        >
          🗀
        </button>
        <button
          className="icon-only"
          title="Refresh the file tree"
          aria-label="Refresh"
          onClick={() => void loadDir('')}
        >
          ↻
        </button>
      </div>

      <div className="tree" role="tree" aria-label="Files">
        {draft?.parent === '' && (
          <DraftRow
            depth={0}
            isDirectory={draft.isDirectory}
            onCommit={(name) => void create('', name, draft.isDirectory)}
            onCancel={() => setDraft(null)}
          />
        )}

        {(tree[''] ?? []).map((entry) => (
          <Row
            key={entry.path}
            entry={entry}
            depth={0}
            draft={draft}
            renaming={renaming}
            onMenu={setMenu}
            onCreate={create}
            onRename={rename}
            onCancelDraft={() => setDraft(null)}
            onCancelRename={() => setRenaming(null)}
          />
        ))}

        {(tree[''] ?? []).length === 0 && <div className="tree-empty">This folder is empty</div>}
      </div>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setDraft({ parent: menu.isDirectory ? menu.path : parentOf(menu.path), isDirectory: false })
              setMenu(null)
            }}
          >
            New File
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setDraft({ parent: menu.isDirectory ? menu.path : parentOf(menu.path), isDirectory: true })
              setMenu(null)
            }}
          >
            New Folder
          </button>
          <div className="context-sep" />
          <button
            role="menuitem"
            onClick={() => {
              setRenaming(menu.path)
              setMenu(null)
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(menu.path).catch(() => setError('Could not copy path'))
              setMenu(null)
            }}
          >
            Copy Path
          </button>
          <div className="context-sep" />
          <button role="menuitem" className="danger" onClick={() => void remove(menu.path)}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

function Row({
  entry,
  depth,
  draft,
  renaming,
  onMenu,
  onCreate,
  onRename,
  onCancelDraft,
  onCancelRename
}: {
  entry: DirEntry
  depth: number
  draft: Draft | null
  renaming: string | null
  onMenu: (menu: MenuState) => void
  onCreate: (parent: string, name: string, isDirectory: boolean) => Promise<void>
  onRename: (from: string, name: string) => Promise<void>
  onCancelDraft: () => void
  onCancelRename: () => void
}): JSX.Element {
  const { expanded, tree, activePath, git, toggleDir, openFile } = useStore()
  const isOpen = expanded.has(entry.path)
  const badge = statusBadge(entry.path, git)

  if (renaming === entry.path) {
    return (
      <DraftRow
        depth={depth}
        isDirectory={entry.isDirectory}
        initial={entry.name}
        onCommit={(name) => void onRename(entry.path, name)}
        onCancel={onCancelRename}
      />
    )
  }

  return (
    <>
      <div
        className={`tree-row${activePath === entry.path ? ' active' : ''}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        role="treeitem"
        aria-expanded={entry.isDirectory ? isOpen : undefined}
        aria-selected={activePath === entry.path}
        tabIndex={0}
        onClick={() => (entry.isDirectory ? void toggleDir(entry.path) : void openFile(entry.path))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          if (entry.isDirectory) void toggleDir(entry.path)
          else void openFile(entry.path)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onMenu({ x: e.clientX, y: e.clientY, path: entry.path, isDirectory: entry.isDirectory })
        }}
        title={entry.path}
      >
        <span className="tree-caret" aria-hidden="true">
          {entry.isDirectory ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="tree-icon" aria-hidden="true">
          {entry.isDirectory ? (isOpen ? '📂' : '📁') : '📄'}
        </span>
        <span className="tree-name">{entry.name}</span>
        {badge && (
          <span className={`tree-badge ${badge.className}`} title={badge.label} aria-label={badge.label}>
            {badge.letter}
          </span>
        )}
      </div>

      {entry.isDirectory && isOpen && (
        <>
          {draft?.parent === entry.path && (
            <DraftRow
              depth={depth + 1}
              isDirectory={draft.isDirectory}
              onCommit={(name) => void onCreate(entry.path, name, draft.isDirectory)}
              onCancel={onCancelDraft}
            />
          )}
          {(tree[entry.path] ?? []).map((child) => (
            <Row
              key={child.path}
              entry={child}
              depth={depth + 1}
              draft={draft}
              renaming={renaming}
              onMenu={onMenu}
              onCreate={onCreate}
              onRename={onRename}
              onCancelDraft={onCancelDraft}
              onCancelRename={onCancelRename}
            />
          ))}
        </>
      )}
    </>
  )
}

/** Inline text field used for both "new file" and "rename". */
function DraftRow({
  depth,
  isDirectory,
  initial = '',
  onCommit,
  onCancel
}: {
  depth: number
  isDirectory: boolean
  initial?: string
  onCommit: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    // Select the basename but not the extension, which is what you usually retype.
    const dot = initial.lastIndexOf('.')
    input.current?.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial])

  return (
    <div className="tree-row draft" style={{ paddingLeft: depth * 12 + 8 }}>
      <span className="tree-caret" />
      <span className="tree-icon" aria-hidden="true">
        {isDirectory ? '📁' : '📄'}
      </span>
      <input
        ref={input}
        className="tree-input"
        defaultValue={initial}
        aria-label={isDirectory ? 'Folder name' : 'File name'}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') onCancel()
        }}
      />
    </div>
  )
}
