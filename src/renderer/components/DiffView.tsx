import { useEffect, useState } from 'react'
import { call, useStore } from '../state/store'
import type { DiffKind, GitDiff } from '@shared/ipc'

/** One rendered line of a unified diff. */
interface Line {
  kind: 'add' | 'del' | 'context' | 'hunk' | 'meta'
  text: string
}

function parsePatch(patch: string): Line[] {
  return patch
    .split('\n')
    .filter((line, i, all) => !(line === '' && i === all.length - 1))
    .map((text): Line => {
      if (text.startsWith('@@')) return { kind: 'hunk', text }
      if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ') || text.startsWith('index '))
        return { kind: 'meta', text }
      if (text.startsWith('+')) return { kind: 'add', text }
      if (text.startsWith('-')) return { kind: 'del', text }
      return { kind: 'context', text }
    })
    .filter((line) => line.kind !== 'meta')
}

/** The three diff sides, each with an explanation — "Unstaged/Staged/All" alone is cryptic. */
const KINDS = [
  { id: 'worktree', label: 'Unstaged', help: 'Changes you have not staged yet (working tree vs index)' },
  { id: 'staged', label: 'Staged', help: 'Changes staged for the next commit (index vs HEAD)' },
  { id: 'head', label: 'All', help: 'Everything since the last commit (working tree vs HEAD)' }
] as const satisfies ReadonlyArray<{ id: DiffKind; label: string; help: string }>

export function DiffView({ path }: { path: string }): JSX.Element {
  const { git, showDiff } = useStore()
  const [kind, setKind] = useState<DiffKind>('worktree')
  const [diff, setDiff] = useState<GitDiff | null>(null)

  // Re-fetch whenever the file, the side, or the git status changes — the last of
  // those is what makes the diff follow along as Claude edits.
  useEffect(() => {
    let cancelled = false
    void call('git:diff', path, kind).then((d) => {
      if (!cancelled) setDiff(d)
    })
    return () => {
      cancelled = true
    }
  }, [path, kind, git])

  const lines = diff ? parsePatch(diff.patch) : []
  const added = lines.filter((l) => l.kind === 'add').length
  const removed = lines.filter((l) => l.kind === 'del').length

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-path" title={path}>
          {path}
        </span>
        <span className="diff-stat">
          <span className="diff-added" title={`${added} lines added`}>
            +{added}
          </span>{' '}
          <span className="diff-removed" title={`${removed} lines removed`}>
            −{removed}
          </span>
        </span>

        <div className="diff-kind" role="group" aria-label="Which changes to show">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? 'active' : ''}
              title={k.help}
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <button className="icon-only" title="Close diff" aria-label="Close diff" onClick={() => showDiff(null)}>
          ×
        </button>
      </div>

      <div className="diff-body">
        {diff?.binary ? (
          <div className="panel-empty">
            <p className="empty-title">Binary file</p>
            <p className="hint">There is no text diff to show.</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="panel-empty">
            <p className="empty-title">Nothing here</p>
            <p className="hint">
              This file has no {kind === 'staged' ? 'staged' : 'unstaged'} changes. Try another
              tab above.
            </p>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`diff-line diff-${line.kind}`}>
              {line.text || ' '}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
