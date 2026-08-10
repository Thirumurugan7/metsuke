import { useEffect, useState } from 'react'
import { call, useStore } from '../state/store'
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

const LETTERS: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!'
}

/** The single letters are conventional but opaque; these back them with a tooltip. */
const STATE_LABELS: Record<string, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  conflicted: 'Conflicted — resolve before committing'
}

export function GitPanel(): JSX.Element {
  const { workspace, git, refreshGit, showDiff, setError } = useStore()
  const [message, setMessage] = useState('')
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!workspace?.isGitRepo) return
    void call('git:branches').then((b) => b && setBranches(b))
    void call('git:log', { limit: 30 }).then((l) => l && setLog(l))
  }, [workspace, git?.branch])

  if (!workspace) return <div className="panel-empty">No folder open</div>
  if (!workspace.isGitRepo) return <div className="panel-empty">Not a git repository</div>
  if (!git) return <div className="panel-empty">Loading…</div>

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

  return (
    <div className="git-panel">
      <div className="git-branch-bar">
        <select
          value={git.branch ?? ''}
          disabled={git.detached}
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
            className="labelled"
            disabled={busy !== null}
            title={git.behind ? `Pull ${git.behind} incoming commit(s)` : 'Pull from the remote'}
            onClick={() => void run('pull', () => call('git:pull', {}))}
          >
            <span aria-hidden="true">↓</span> Pull{git.behind > 0 && ` (${git.behind})`}
          </button>
          <button
            className="labelled"
            disabled={busy !== null}
            title={
              git.upstream
                ? `Push ${git.ahead} outgoing commit(s)`
                : 'Publish this branch to the remote'
            }
            onClick={() => void run('push', () => call('git:push', { setUpstream: !git.upstream }))}
          >
            <span aria-hidden="true">↑</span> {git.upstream ? 'Push' : 'Publish'}
            {git.ahead > 0 && ` (${git.ahead})`}
          </button>
        </div>
      </div>

      {busy && <div className="git-busy">Running git {busy}…</div>}

      <div className="git-commit">
        <textarea
          placeholder={`Commit message (⌘Enter to commit on ${git.branch ?? 'HEAD'})`}
          aria-label="Commit message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
          }}
        />
        {/*
          With nothing staged this button used to be simply disabled, with no
          explanation and no way forward. Now it offers to stage everything first,
          which is what the user meant anyway.
        */}
        <button
          className="primary"
          disabled={busy !== null || (staged.length === 0 && changes.length === 0)}
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
      </div>

      <Section
        title="Staged Changes"
        count={staged.length}
        files={staged}
        side="staged"
        onDiff={(p) => showDiff(p)}
        action={{
          label: '−',
          title: 'Unstage',
          run: (paths) => run('unstage', () => call('git:unstage', paths))
        }}
        emptyHint="Stage a change below to include it in the next commit."
      />

      <Section
        title="Changes"
        count={changes.length}
        files={changes}
        side="unstaged"
        onDiff={(p) => showDiff(p)}
        action={{
          label: '+',
          title: 'Stage',
          run: (paths) => run('stage', () => call('git:stage', paths))
        }}
        secondaryAction={{
          label: '↺',
          title: 'Discard changes',
          run: async (paths) => {
            if (!confirm(`Discard changes to ${paths.length} file(s)? This cannot be undone.`)) return
            await run('discard', () => call('git:discard', paths))
          }
        }}
        emptyHint="Working tree is clean."
      />

      <div className="git-log">
        <div className="section-header">
          <span>History</span>
        </div>
        {log.length === 0 && <div className="section-empty">No commits yet</div>}
        {log.map((entry) => (
          <div
            key={entry.hash}
            className="log-row"
            title={`${entry.subject}\n${entry.author} · ${new Date(entry.date).toLocaleString()}\n${entry.hash}`}
          >
            <span className="log-hash">{entry.shortHash}</span>
            <span className="log-subject">{entry.subject}</span>
            <span className="log-author">{entry.author}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface Action {
  label: string
  title: string
  run: (paths: string[]) => Promise<void>
}

function Section({
  title,
  count,
  files,
  side,
  onDiff,
  action,
  secondaryAction,
  emptyHint
}: {
  title: string
  count: number
  files: GitFileChange[]
  side: 'staged' | 'unstaged'
  onDiff: (path: string) => void
  action: Action
  secondaryAction?: Action
  emptyHint: string
}): JSX.Element {
  const allPaths = files.map((f) => f.path)

  // An empty section used to vanish entirely, so a clean tree showed a bare panel with
  // no indication of what the sections even were.
  if (count === 0) {
    return (
      <div className="git-section">
        <div className="section-header">
          <span>
            {title} <span className="count">0</span>
          </span>
        </div>
        <div className="section-empty">{emptyHint}</div>
      </div>
    )
  }

  return (
    <div className="git-section">
      <div className="section-header">
        <span>
          {title} <span className="count">{count}</span>
        </span>
        <button
          className="labelled"
          title={`${action.title} all ${count} file(s)`}
          onClick={() => void action.run(allPaths)}
        >
          {action.title} all
        </button>
      </div>

      {files.map((file) => {
        const state = side === 'staged' ? file.staged : file.unstaged
        return (
          <div key={`${side}:${file.path}`} className="git-row" onClick={() => onDiff(file.path)}>
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
                  {secondaryAction.label}
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
                {action.label}
              </button>
              <span className={`git-letter letter-${state}`} title={STATE_LABELS[state] ?? state}>
                {LETTERS[state] ?? ''}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
