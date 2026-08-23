import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Modal } from './Modal'
import type { ThreadMode } from '@shared/ipc'

/**
 * What each mode actually costs, stated where the choice is made.
 *
 * Subagents are widely assumed to share context with their parent. They do the
 * opposite: they isolate it, which is why they are cheap for wide work and useless when
 * you wanted the detail. Burying that in documentation would guarantee people pick
 * wrong, so it sits on the card.
 */
const MODES: Array<{
  id: ThreadMode
  glyph: string
  title: string
  points: string[]
  cost: string
}> = [
  {
    id: 'subagent',
    glyph: '↳',
    title: 'Subagent',
    points: [
      'Runs inside a thread you already have',
      'Gets the prompt you write here, hands back a summary',
      'Its file reads and searches never enter that conversation',
      'Best for wide, throwaway work: find every X, check every Y'
    ],
    cost: 'It does not share context back. You see the report, not the work, and if you need the detail later it is gone.'
  },
  {
    id: 'instance',
    glyph: '◆',
    title: 'New session',
    points: [
      'Its own claude process and its own conversation',
      'Optionally its own worktree and branch, so it cannot touch your files',
      'Keeps running while you work elsewhere, and you can come back',
      'Best for work that ends in a branch you review and merge'
    ],
    cost: 'It starts cold. It reads CLAUDE.md rather than this conversation, so it pays the onboarding cost every time you open one.'
  }
]

export function NewThread(): JSX.Element | null {
  const open = useStore((s) => s.newThreadOpen)
  const presetMode = useStore((s) => s.newThreadPresetMode)
  const setOpen = useStore((s) => s.setNewThreadOpen)
  const createThread = useStore((s) => s.createThread)
  const threads = useStore((s) => s.threads)
  const isGitRepo = useStore((s) => s.workspace?.isGitRepo ?? false)

  const [mode, setMode] = useState<ThreadMode>('instance')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [worktree, setWorktree] = useState(true)
  const [parentId, setParentId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const instances = threads.filter((t) => t.mode === 'instance' && t.endedAt === null)

  // Fresh every time it opens, so yesterday's half-typed prompt never gets sent.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setPrompt('')
    setBusy(false)
    setMode(presetMode ?? (instances.length > 0 ? 'subagent' : 'instance'))
    setParentId(instances[0]?.id ?? '')
    setWorktree(isGitRepo)
    titleRef.current?.focus()
    // Only when the sheet opens. Recomputing on every keystroke would wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const canStart = title.trim().length > 0 && !busy && (mode === 'instance' || instances.length > 0)

  const start = async (): Promise<void> => {
    if (!canStart) return
    setBusy(true)
    await createThread({
      title: title.trim(),
      mode,
      // Only instances get their own checkout here; a subagent asks its parent for one.
      worktree: worktree && isGitRepo,
      prompt: prompt.trim() || undefined,
      parentId: mode === 'subagent' ? parentId || undefined : undefined
    })
    setBusy(false)
  }

  return (
    <Modal variant="dialog" label="New session" onClose={() => setOpen(false)} initialFocus={titleRef}>
      <h2 className="sheet-title">New session</h2>
      <p className="sheet-sub">
        Two ways to run it. They are not the same thing and the difference matters.
      </p>

        <div className="sheet-modes">
          {MODES.map((option) => {
            const unavailable = option.id === 'subagent' && instances.length === 0
            return (
              <button
                key={option.id}
                className={`sheet-mode${mode === option.id ? ' on' : ''}${unavailable ? ' unavailable' : ''}`}
                onClick={() => !unavailable && setMode(option.id)}
                aria-pressed={mode === option.id}
                disabled={unavailable}
                title={unavailable ? 'Start a session first: a subagent runs inside one' : undefined}
              >
                <span className="sheet-glyph" aria-hidden="true">
                  {option.glyph}
                </span>
                <span className="sheet-mode-title">{option.title}</span>
                <ul>
                  {option.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <span className="sheet-cost">{option.cost}</span>
                {unavailable && (
                  <span className="sheet-unavailable">Needs a running instance to live in</span>
                )}
              </button>
            )
          })}
        </div>

        <label className="sheet-field">
          <span>What is it doing?</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Fix checkout 500 on empty cart"
            onKeyDown={(e) => e.key === 'Enter' && void start()}
          />
        </label>

        <label className="sheet-field">
          <span>Opening prompt {mode === 'subagent' ? '' : '(optional)'}</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={
              mode === 'subagent'
                ? 'Everything it needs to know. It cannot see this conversation.'
                : 'Sent once the session is up. Leave empty to start it yourself.'
            }
          />
        </label>

        {mode === 'subagent' && instances.length > 1 && (
          <label className="sheet-field">
            <span>Run it inside</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.title}
                  {instance.branch ? ` (⑂ ${instance.branch})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="sheet-foot">
          <label className={`sheet-check${isGitRepo ? '' : ' disabled'}`}>
            <input
              type="checkbox"
              checked={worktree && isGitRepo}
              disabled={!isGitRepo}
              onChange={(e) => setWorktree(e.target.checked)}
            />
            <span>
              Give it its own worktree
              {!isGitRepo && <em> (this folder is not a git repository)</em>}
            </span>
          </label>
          <div className="sheet-buttons">
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="primary" onClick={() => void start()} disabled={!canStart}>
              {busy ? 'Starting…' : 'Start session'}
            </button>
          </div>
        </div>
    </Modal>
  )
}
