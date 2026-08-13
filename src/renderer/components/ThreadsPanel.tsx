import { useEffect, useState } from 'react'
import { call, useStore } from '../state/store'
import type { Thread, ThreadStatus } from '@shared/ipc'

/** Glyph and colour class per status, so the list reads at a glance and not by label. */
const DOT: Record<ThreadStatus, { glyph: string; cls: string; label: string }> = {
  running: { glyph: '●', cls: 'run', label: 'running' },
  waiting: { glyph: '◐', cls: 'wait', label: 'waiting on you' },
  idle: { glyph: '○', cls: 'idle', label: 'idle' },
  done: { glyph: '○', cls: 'done', label: 'finished' },
  failed: { glyph: '●', cls: 'fail', label: 'failed' }
}

/** "4m", "2h", "3d". Absolute times are noise for something that started minutes ago. */
function age(from: number, to: number | null): string {
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

/**
 * The two shapes of work Claude runs in, in one list.
 *
 * An instance is a top-level row carrying its own branch. A subagent is indented under
 * the instance that spawned it, because that is where it actually lives: it has no
 * process and no terminal of its own, and its file reads never enter the parent's
 * context. Drawing them the same would suggest they cost the same, and they do not.
 */
export function ThreadsPanel(): JSX.Element {
  const threads = useStore((s) => s.threads)
  const selected = useStore((s) => s.selectedThread)
  const workspace = useStore((s) => s.workspace)
  const selectThread = useStore((s) => s.selectThread)
  const closeThread = useStore((s) => s.closeThread)
  const openLandThread = useStore((s) => s.openLandThread)
  const setNewThreadOpen = useStore((s) => s.setNewThreadOpen)
  // Only one report open at a time: they are long, and two expanded at once turns the
  // sidebar into a wall of text with no list left to navigate.
  const [openReport, setOpenReport] = useState<string | null>(null)

  /*
   * Diff stats only move when a thread commits, so polling slowly is plenty, and it
   * keeps a `git diff` off the hook path, which has to stay fast or it delays Claude.
   * Skipped entirely when nothing owns a branch, which is the common case.
   */
  useEffect(() => {
    if (!workspace) return
    const timer = setInterval(() => {
      if (useStore.getState().threads.some((t) => t.branch)) void call('threads:refresh')
    }, 15000)
    return () => clearInterval(timer)
  }, [workspace])

  const running = threads.filter((t) => t.status === 'running').length

  return (
    <div className="threads-panel">
      <div className="threads-actions">
        <button
          className="thread-new"
          onClick={() => setNewThreadOpen(true)}
          disabled={!workspace}
          title={workspace ? 'Start a thread' : 'Open a folder first'}
        >
          ＋ New thread
        </button>
        {running > 0 && <span className="threads-count">{running} running</span>}
      </div>

      {threads.length === 0 ? (
        <p className="threads-empty">
          No threads yet. A thread is either its own <b>claude</b> session on its own
          branch, or a <b>subagent</b> running inside one. Start one and it appears here
          with its status, its branch and what it has changed.
        </p>
      ) : (
        <ul className="thread-list">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              selected={selected === thread.id}
              onSelect={() => selectThread(thread.id)}
              onClose={() => void closeThread(thread.id, { removeWorktree: true })}
              onLand={() => void openLandThread(thread.id)}
              expanded={openReport === thread.id}
              onToggleReport={() =>
                setOpenReport((current) => (current === thread.id ? null : thread.id))
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ThreadRow({
  thread,
  selected,
  onSelect,
  onClose,
  onLand,
  expanded,
  onToggleReport
}: {
  thread: Thread
  selected: boolean
  onSelect: () => void
  onClose: () => void
  onLand: () => void
  expanded: boolean
  onToggleReport: () => void
}): JSX.Element {
  const dot = DOT[thread.status]
  const sub = thread.mode === 'subagent'

  return (
    <li className={`thread-row${sub ? ' sub' : ''}${selected ? ' selected' : ''}`}>
      <button className="thread-hit" onClick={onSelect} title={thread.title}>
        <span className={`thread-dot ${dot.cls}`} aria-label={dot.label}>
          {dot.glyph}
        </span>
        <span className="thread-text">
          <span className="thread-name">
            {sub && <span className="thread-arrow">↳</span>}
            {thread.title}
          </span>
          <span className="thread-meta">
            <span className="thread-kind">{sub ? 'subagent' : '◆ instance'}</span>
            {thread.branch && <span className="thread-branch">⑂ {thread.branch}</span>}
            {(thread.added > 0 || thread.removed > 0) && (
              <span className="thread-stat">
                <span className="add">+{thread.added}</span> <span className="del">−{thread.removed}</span>
              </span>
            )}
            {thread.detail && <span className="thread-detail">{thread.detail}</span>}
            <span className="thread-age">{age(thread.createdAt, thread.endedAt)}</span>
          </span>
        </span>
      </button>
      {thread.branch && (
        <button
          className="thread-land"
          onClick={onLand}
          title={`Merge ${thread.branch} into the branch you have open`}
          aria-label={`Land ${thread.title}`}
        >
          ⤓
        </button>
      )}
      <button
        className="thread-close"
        onClick={onClose}
        title={thread.worktree ? 'Close and remove its worktree, keeping the branch' : 'Close thread'}
        aria-label={`Close ${thread.title}`}
      >
        ×
      </button>

      {thread.report && (
        <button
          className="thread-report-toggle"
          onClick={onToggleReport}
          aria-expanded={expanded}
          title={expanded ? 'Hide what it reported' : 'Show what it reported'}
        >
          {expanded ? '▾' : '▸'} report
        </button>
      )}

      {expanded && thread.report && (
        <pre className="thread-report">{thread.report}</pre>
      )}
    </li>
  )
}
