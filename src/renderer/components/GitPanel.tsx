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
            disabled={busy !== null}
            title={git.behind ? `${git.behind} commits to pull` : 'Pull'}
            onClick={() => void run('pull', () => call('git:pull', {}))}
          >
            ↓ {git.behind || ''}
          </button>
          <button
            disabled={busy !== null}
            title={git.upstream ? `${git.ahead} commits to push` : 'Publish branch'}
            onClick={() => void run('push', () => call('git:push', { setUpstream: !git.upstream }))}
          >
            ↑ {git.ahead || ''}
          </button>
        </div>
      </div>

      <div className="git-commit">
        <textarea
          placeholder={`Message (⌘Enter to commit on ${git.branch ?? 'HEAD'})`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commit()
          }}
        />
        <button disabled={busy !== null || staged.length === 0} onClick={() => void commit()}>
          Commit {staged.length > 0 && `(${staged.length})`}
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
      />

      <div className="git-log">
        <div className="section-header">History</div>
        {log.map((entry) => (
          <div key={entry.hash} className="log-row" title={`${entry.author} · ${entry.date}`}>
            <span className="log-hash">{entry.shortHash}</span>
            <span className="log-subject">{entry.subject}</span>
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
  secondaryAction
}: {
  title: string
  count: number
  files: GitFileChange[]
  side: 'staged' | 'unstaged'
  onDiff: (path: string) => void
  action: Action
  secondaryAction?: Action
}): JSX.Element | null {
  if (count === 0) return null
  const allPaths = files.map((f) => f.path)

  return (
    <div className="git-section">
      <div className="section-header">
        <span>
          {title} <span className="count">{count}</span>
        </span>
        <button title={`${action.title} all`} onClick={() => void action.run(allPaths)}>
          {action.label}
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
                  title={secondaryAction.title}
                  onClick={(e) => {
                    e.stopPropagation()
                    void secondaryAction.run([file.path])
                  }}
                >
                  {secondaryAction.label}
                </button>
              )}
              <button
                title={action.title}
                onClick={(e) => {
                  e.stopPropagation()
                  void action.run([file.path])
                }}
              >
                {action.label}
              </button>
              <span className={`git-letter letter-${state}`}>{LETTERS[state] ?? ''}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
