import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { statusBadge } from '../state/gitStatus'
import { useListKeyNav } from '../state/useListKeyNav'
import { Icon } from './Icon'
import { Modal } from './Modal'
import type { GitBranch, GitFileChange, GitLogEntry } from '@shared/ipc'

/** Files split into the two sections the panel shows. */
function partition(files: GitFileChange[]): { staged: GitFileChange[]; changes: GitFileChange[] } {
  return {
    staged: files.filter((f) => f.staged !== 'unchanged' && f.staged !== 'ignored'),
    changes: files.filter(
      (f) => f.unstaged !== 'unchanged' && f.unstaged !== 'ignored'
    )
  }
}

/**
 * The panel header's actions slot (K8): refresh, plus an overflow menu for the
 * less-frequent operations. Self-contained — it does not share `busy`/`message` with
 * the main panel body, since none of these three operations need to.
 */
export function GitPanelActions(): JSX.Element {
  const workspace = useStore((s) => s.workspace)
  const refreshGit = useStore((s) => s.refreshGit)
  const requestDiscardAll = useStore((s) => s.requestDiscardAll)
  const [menu, setMenu] = useState<{ right: number; top: number } | null>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const [running, setRunning] = useState<string | null>(null)
  const open = menu !== null

  useEffect(() => {
    if (!open) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggleMenu = (): void => {
    if (open) return setMenu(null)
    const rect = moreButton.current?.getBoundingClientRect()
    if (!rect) return
    setMenu({ right: window.innerWidth - rect.right, top: rect.bottom + 4 })
  }

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setMenu(null)
    setRunning(label)
    try {
      await action()
      await refreshGit()
    } finally {
      setRunning(null)
    }
  }

  return (
    <>
      <button
        className="icon-only"
        title="Refresh git status"
        aria-label="Refresh git status"
        disabled={!workspace?.isGitRepo || running !== null}
        onClick={() => void refreshGit()}
      >
        <Icon name="reload" />
      </button>
      <button
        ref={moreButton}
        className="icon-only"
        title="More git actions"
        aria-label="More git actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!workspace?.isGitRepo || running !== null}
        onClick={(e) => {
          e.stopPropagation()
          toggleMenu()
        }}
      >
        <Icon name="more" />
      </button>
      {menu && (
        <div
          className="context-menu"
          role="menu"
          style={{ right: menu.right, top: menu.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={() => void run('stash', () => call('git:stash'))}>
            Stash all changes
          </button>
          <button role="menuitem" onClick={() => void run('fetch', () => call('git:fetch'))}>
            Fetch
          </button>
          <div className="context-sep" />
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenu(null)
              requestDiscardAll()
            }}
          >
            Discard all changes
          </button>
        </div>
      )}
    </>
  )
}

export function GitPanel(): JSX.Element {
  const { workspace, git, refreshGit, showDiff, setError, gitSectionsCollapsed, toggleGitSection, discardAllRequest } =
    useStore()
  const [message, setMessage] = useState('')
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<string[] | null>(null)
  const cancelDiscardRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!workspace?.isGitRepo) return
    void call('git:branches').then((b) => b && setBranches(b))
    void call('git:log', { limit: 30 }).then((l) => l && setLog(l))
  }, [workspace, git?.branch])

  // The header's overflow menu (GitPanelActions) has no access to this panel's own
  // discard-confirmation state, so it asks for one via the same nonce pattern
  // preview.reload and search.clear already use. Compared against the last value THIS
  // instance saw, not against 0 — switching sidebar views remounts GitPanel, and a
  // fresh mount otherwise replayed whatever the counter already stood at, reopening
  // the confirmation dialog on a plain view switch with no click involved.
  const lastDiscardAllRequest = useRef(discardAllRequest)
  useEffect(() => {
    if (discardAllRequest === lastDiscardAllRequest.current) return
    lastDiscardAllRequest.current = discardAllRequest
    const paths = git?.files.filter((f) => f.unstaged !== 'unchanged' && f.unstaged !== 'ignored').map((f) => f.path)
    if (paths && paths.length > 0) setDiscardTarget(paths)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardAllRequest])

  const onListKeyDown = useListKeyNav({
    rowSelector: '.git-row[role="option"]',
    onFocusChange: () => {}
  })

  if (!workspace) {
    return (
      <div className="panel-empty">
        <p className="empty-title">No folder open</p>
        <p className="hint">Open a folder to see its changes here.</p>
        <button className="primary" onClick={() => void useStore.getState().openFolder()}>
          Open Folder
        </button>
      </div>
    )
  }
  if (!workspace.isGitRepo) {
    return (
      <div className="panel-empty">
        <p className="empty-title">This folder is not a git repository</p>
        <p className="hint">Metsuke tracks changes once it is.</p>
      </div>
    )
  }
  if (!git) {
    return (
      <div className="panel-empty">
        <p className="empty-title">Reading git status</p>
      </div>
    )
  }

  const { staged, changes } = partition(git.files)

  /** Run a git action, keeping the button disabled and surfacing failures inline. */
  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try {
      await action()
      await refreshGit()
    } finally {
      setBusy(null)
    }
  }

  const commit = async (): Promise<void> => {
    if (!message.trim()) return setError('Enter a commit message first')

    await run('commit', async () => {
      // Committing with an empty index would fail with git's own confusing message,
      // so stage everything first when that is plainly the intent.
      if (staged.length === 0) {
        if ((await call('git:stage', changes.map((f) => f.path))) === null) return
      }
      const hash = await call('git:commit', message, {})
      if (hash) setMessage('')
    })
    void call('git:log', { limit: 30 }).then((l) => l && setLog(l))
  }

  const confirmDiscard = async (): Promise<void> => {
    const paths = discardTarget
    if (!paths) return
    setDiscardTarget(null)
    await run('discard', () => call('git:discard', paths))
  }

  return (
    <div className="git-panel panel">
      <div className="panel-toolbar">
        <Icon name="branch" />
        <select
          value={git.branch ?? ''}
          disabled={git.detached}
          aria-label="Current branch"
          onChange={(e) => void run('checkout', () => call('git:checkout', e.target.value, {}))}
        >
          {git.detached && <option value="">(detached HEAD)</option>}
          {branches
            .filter((b) => !b.remote)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>

        <div className="git-sync">
          <button
            className="icon-only"
            disabled={busy !== null}
            title={git.behind ? `Pull ${git.behind} incoming commit(s)` : 'Pull from the remote'}
            onClick={() => void run('pull', () => call('git:pull', {}))}
          >
            <Icon name="pull" />
            {git.behind > 0 && git.behind}
          </button>
          {git.upstream ? (
            <button
              className="icon-only"
              disabled={busy !== null}
              title={`Push ${git.ahead} outgoing commit(s)`}
              onClick={() => void run('push', () => call('git:push', { setUpstream: false }))}
            >
              <Icon name="push" />
              {git.ahead > 0 && git.ahead}
            </button>
          ) : (
            <button
              className="labelled"
              disabled={busy !== null}
              title="Publish this branch to the remote"
              onClick={() => void run('push', () => call('git:push', { setUpstream: true }))}
            >
              Publish
            </button>
          )}
        </div>
      </div>

      <div className="panel-content" onKeyDown={onListKeyDown}>
        <div className="git-commit">
          <textarea
            className={message ? 'has-content' : ''}
            placeholder={`Commit message (⌘Enter to commit on ${git.branch ?? 'HEAD'})`}
            aria-label="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
            }}
          />
        </div>

        <Section
          id="staged"
          title="Staged"
          count={staged.length}
          files={staged}
          side="staged"
          // No stored preference yet: collapsed exactly when there is nothing staged.
          collapsed={gitSectionsCollapsed['staged'] ?? staged.length === 0}
          onToggle={() => toggleGitSection('staged')}
          onDiff={(p) => showDiff(p)}
          action={{
            label: 'unstage',
            title: 'Unstage',
            icon: 'unstage',
            run: (paths) => run('unstage', () => call('git:unstage', paths))
          }}
          emptyHint="Stage a change below to include it in the next commit."
        />

        <Section
          id="changes"
          title="Changes"
          count={changes.length}
          files={changes}
          side="unstaged"
          collapsed={gitSectionsCollapsed['changes'] ?? false}
          onToggle={() => toggleGitSection('changes')}
          onDiff={(p) => showDiff(p)}
          action={{
            label: 'add',
            title: 'Stage',
            icon: 'add',
            run: (paths) => run('stage', () => call('git:stage', paths))
          }}
          secondaryAction={{
            label: 'discard',
            title: 'Discard changes',
            icon: 'discard',
            run: async (paths) => setDiscardTarget(paths)
          }}
          emptyHint="Working tree is clean."
        />

        <div className="git-section">
          <button
            className="section-header"
            aria-expanded={!gitSectionsCollapsed['history']}
            onClick={() => toggleGitSection('history')}
          >
            <span className="section-header-title">
              <Icon name={gitSectionsCollapsed['history'] ? 'forward' : 'chevronDown'} size={12} />
              History
            </span>
            <span className="count">{log.length}</span>
          </button>
          {!gitSectionsCollapsed['history'] &&
            (log.length === 0 ? (
              <div className="section-empty">No commits yet.</div>
            ) : (
              log.map((entry) => (
                <div
                  key={entry.hash}
                  className="log-row"
                  title={`${entry.subject}\n${entry.author} · ${new Date(entry.date).toLocaleString()}\n${entry.hash}`}
                >
                  <span className="log-hash">{entry.shortHash}</span>
                  <span className="log-subject">{entry.subject}</span>
                  <span className="log-author">{entry.author}</span>
                </div>
              ))
            ))}
        </div>
      </div>

      <div className="panel-footer">
        {busy ? (
          `Running git ${busy}…`
        ) : (
          <button
            className="primary"
            disabled={staged.length === 0 && changes.length === 0}
            title={
              staged.length > 0
                ? `Commit ${staged.length} staged file(s)`
                : 'Stage every change and commit it'
            }
            onClick={() => void commit()}
          >
            {staged.length > 0
              ? `Commit ${staged.length} staged file${staged.length === 1 ? '' : 's'}`
              : changes.length > 0
                ? `Stage all & commit (${changes.length})`
                : 'Nothing to commit'}
          </button>
        )}
      </div>

      {discardTarget && (
        <Modal
          variant="dialog"
          label={
            discardTarget.length === 1 ? `Discard changes to ${discardTarget[0]}` : `Discard changes to ${discardTarget.length} files`
          }
          onClose={() => setDiscardTarget(null)}
          initialFocus={cancelDiscardRef}
        >
          <h2 className="sheet-title">
            {discardTarget.length === 1 ? (
              <>
                Discard changes to <b>{discardTarget[0].split('/').pop()}</b>?
              </>
            ) : (
              <>
                Discard changes to <b>{discardTarget.length} files</b>?
              </>
            )}
          </h2>
          <p className="sheet-sub">
            {discardTarget.length === 1 ? (
              <code>{discardTarget[0]}</code>
            ) : (
              <>
                {discardTarget.slice(0, 5).map((p) => (
                  <code key={p} style={{ display: 'block' }}>
                    {p}
                  </code>
                ))}
                {discardTarget.length > 5 && <span>and {discardTarget.length - 5} more</span>}
              </>
            )}
          </p>
          <p className="sheet-sub">This cannot be undone.</p>
          <div className="sheet-foot">
            <div className="sheet-buttons">
              <button ref={cancelDiscardRef} className="ghost" onClick={() => setDiscardTarget(null)}>
                Cancel
              </button>
              <button className="danger" onClick={() => void confirmDiscard()}>
                Discard
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface Action {
  label: string
  title: string
  icon: 'unstage' | 'add' | 'discard'
  run: (paths: string[]) => Promise<void>
}

function Section({
  id,
  title,
  count,
  files,
  side,
  collapsed,
  onToggle,
  onDiff,
  action,
  secondaryAction,
  emptyHint
}: {
  id: string
  title: string
  count: number
  files: GitFileChange[]
  side: 'staged' | 'unstaged'
  collapsed: boolean
  onToggle: () => void
  onDiff: (path: string) => void
  action: Action
  secondaryAction?: Action
  emptyHint: string
}): JSX.Element {
  const allPaths = files.map((f) => f.path)

  return (
    <div className="git-section" data-section={id}>
      <button className="section-header" aria-expanded={!collapsed} onClick={onToggle}>
        <span className="section-header-title">
          <Icon name={collapsed ? 'forward' : 'chevronDown'} size={12} />
          {title}
        </span>
        <span className="count">{count}</span>
      </button>

      {!collapsed &&
        (count === 0 ? (
          <div className="section-empty">{emptyHint}</div>
        ) : (
          <>
            {files.map((file) => {
              const state = side === 'staged' ? file.staged : file.unstaged
              const badge = statusBadge(state)
              return (
                <div
                  key={`${side}:${file.path}`}
                  className="git-row"
                  role="option"
                  aria-selected="false"
                  tabIndex={0}
                  data-path={file.path}
                  onClick={() => onDiff(file.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onDiff(file.path)
                  }}
                >
                  <span className="git-row-icon" aria-hidden="true">
                    <Icon name="file" />
                  </span>
                  <span className="git-path" title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}>
                    {file.path.split('/').pop()}
                    <span className="git-dir">{file.path.split('/').slice(0, -1).join('/')}</span>
                  </span>

                  <span className="git-actions">
                    {secondaryAction && (
                      <button
                        className="icon-only"
                        title={`${secondaryAction.title} — ${file.path}`}
                        aria-label={`${secondaryAction.title} ${file.path}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void secondaryAction.run([file.path])
                        }}
                      >
                        <Icon name={secondaryAction.icon} />
                      </button>
                    )}
                    <button
                      className="icon-only"
                      title={`${action.title} — ${file.path}`}
                      aria-label={`${action.title} ${file.path}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        void action.run([file.path])
                      }}
                    >
                      <Icon name={action.icon} />
                    </button>
                  </span>
                  {badge && (
                    <span className={`tree-badge ${badge.className}`} title={badge.label} aria-label={badge.label}>
                      {badge.letter}
                    </span>
                  )}
                </div>
              )
            })}
            <button
              className="labelled"
              title={`${action.title} all ${count} file(s)`}
              onClick={() => void action.run(allPaths)}
              style={{ margin: '2px var(--panel-gutter)' }}
            >
              {action.title} all
            </button>
          </>
        ))}
    </div>
  )
}
