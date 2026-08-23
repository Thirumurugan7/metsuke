import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { Modal } from './Modal'

/**
 * What landing a thread would do, and the button that does it.
 *
 * A thread's whole output is a branch, and until now there was no way to land one from
 * the editor: you got a branch and were left to merge it in a terminal. This closes that
 * loop, and it shows the merge preview before the merge rather than after, because the
 * question you actually have is "will this conflict" and the honest time to answer it is
 * while you can still decide not to.
 */
export function LandThread(): JSX.Element | null {
  const id = useStore((s) => s.landingThread)
  const preview = useStore((s) => s.landPreview)
  const threads = useStore((s) => s.threads)
  const close = useStore((s) => s.closeLandThread)
  const land = useStore((s) => s.landThread)

  const [deleteBranch, setDeleteBranch] = useState(false)
  const [busy, setBusy] = useState(false)

  const thread = threads.find((t) => t.id === id)

  useEffect(() => {
    if (!id) return
    setDeleteBranch(false)
    setBusy(false)
  }, [id])

  if (!id || !thread) return null

  const conflicts = preview?.conflicts ?? []
  const unknown = preview?.conflictsKnown === false
  const blocked = conflicts.length > 0

  const run = async (): Promise<void> => {
    setBusy(true)
    await land(id, { deleteBranch })
    setBusy(false)
  }

  const target = preview?.base ?? 'the base branch'

  return (
    <Modal variant="dialog" label={`Merge into ${target}`} onClose={close}>
      <h2 className="sheet-title">
        Merge &ldquo;{thread.title}&rdquo; into {target}
      </h2>

      {!preview ? (
        <p className="sheet-sub">Working out what this would change…</p>
      ) : preview.alreadyMerged ? (
        <p className="sheet-sub">
          Everything on <b>{preview.branch}</b> is already in <b>{preview.base}</b>. Merging it
          just closes the session and removes its worktree.
        </p>
      ) : (
        <>
          <p className="sheet-sub">
            Merging <b>{preview.branch}</b> into <b>{preview.base}</b>:{' '}
            {preview.commits} commit{preview.commits === 1 ? '' : 's'},{' '}
            <span className="add">+{preview.added}</span>{' '}
            <span className="del">−{preview.removed}</span>.
          </p>

          {blocked && (
            <div className="land-conflicts">
              <p>
                These files changed on both sides and would conflict. Merging is disabled
                until that is resolved, because a half-finished merge in your working tree
                is worse than not starting one.
              </p>
              <ul>
                {conflicts.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            </div>
          )}

          {unknown && (
            <p className="land-unknown">
              This version of git cannot say in advance whether the merge conflicts. If it
              does, nothing will be left half-done: the merge is undone and your working
              tree stays as it is.
            </p>
          )}
        </>
      )}

      <div className="sheet-foot">
        <label className="sheet-check">
          <input
            type="checkbox"
            checked={deleteBranch}
            onChange={(e) => setDeleteBranch(e.target.checked)}
          />
          <span>
            Delete the branch afterwards
            <em> (its commits are in {target} either way)</em>
          </span>
        </label>
        <div className="sheet-buttons">
          <button className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary" onClick={() => void run()} disabled={!preview || blocked || busy}>
            {busy ? 'Merging…' : `Merge into ${target}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
