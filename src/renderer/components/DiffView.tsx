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
        <span className="diff-path">{path}</span>
        <span className="diff-stat">
          <span className="diff-added">+{added}</span> <span className="diff-removed">−{removed}</span>
        </span>

        <div className="diff-kind">
          {(['worktree', 'staged', 'head'] as const).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {k === 'worktree' ? 'Unstaged' : k === 'staged' ? 'Staged' : 'All'}
            </button>
          ))}
        </div>

        <button className="diff-close" onClick={() => showDiff(null)}>
          ×
        </button>
      </div>

      <div className="diff-body">
        {diff?.binary ? (
          <div className="panel-empty">Binary file</div>
        ) : lines.length === 0 ? (
          <div className="panel-empty">No changes on this side</div>
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
