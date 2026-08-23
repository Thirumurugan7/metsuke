import { useEffect, useRef, useState } from 'react'
import { call, isRecentableFile, useStore } from '../state/store'
import { getCommand } from '../state/commands'
import { useListKeyNav } from '../state/useListKeyNav'
import { age } from './ThreadsPanel'
import { Icon } from './Icon'

/**
 * One column position, one kind of value (M4). The old inline
 * `path.split('/').slice(0, -1).join('/')` produced a relative folder, an empty string,
 * or a full absolute path depending on which producer put the entry in `recentFiles`.
 * Normalising through the workspace root makes the answer the same shape whichever
 * producer it came from — always workspace-relative, never absolute.
 */
function parentLabel(path: string, root: string): string {
  const rel = path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, '') : path
  return rel.split('/').slice(0, -1).join('/')
}

/**
 * The default state of the largest pane in the app (E1) — an agent workflow rarely has
 * a file open unless you are actively editing one. Shown when a folder is open and
 * nothing is selected; `Welcome.tsx` covers no-folder-open, `EditorPane.tsx` covers an
 * actual file.
 *
 * One column, one left edge (M1/M2), one row idiom for everything actionable on it
 * (M7), and one keyboard list (section 7) rather than three separately-tabbable
 * sections. Rebuilt in batch 12 — see `docs/ux/batch-12-start-panel-and-dismissal.md`
 * for the reasoning; batch 7's layout (a centred primary button plus two link-style
 * secondary actions) is superseded, though its data work — `git:dirtyStat`,
 * `recentFiles`, the summary derivation — is reused unchanged.
 */
export function StartPanel(): JSX.Element {
  const workspace = useStore((s) => s.workspace)
  const git = useStore((s) => s.git)
  const threads = useStore((s) => s.threads)
  const recentFiles = useStore((s) => s.recentFiles)
  const openFile = useStore((s) => s.openFile)
  const setSidebar = useStore((s) => s.setSidebar)

  const [dirtyStat, setDirtyStat] = useState<{ added: number; removed: number } | null>(null)
  // Roving tabIndex (section 7): exactly one row is a tab stop at a time, same pattern
  // Explorer's tree uses for `treeFocus`. Defaults to the New Claude session row, which
  // is also the row focused on mount below.
  const [focusedRow, setFocusedRow] = useState('start.newSession')
  const startRowRef = useRef<HTMLButtonElement>(null)
  const didFocus = useRef(false)

  useEffect(() => {
    if (!workspace?.isGitRepo) return
    let cancelled = false
    void call('git:dirtyStat').then((stat) => {
      if (!cancelled) setDirtyStat(stat)
    })
    return () => {
      cancelled = true
    }
  }, [workspace?.root, workspace?.isGitRepo])

  // Focused once, on first mount — guarded so a later re-render (git or dirtyStat
  // resolving) never steals focus back from wherever the user has since moved it.
  useEffect(() => {
    if (didFocus.current) return
    didFocus.current = true
    startRowRef.current?.focus()
  }, [])

  const onKeyDown = useListKeyNav({
    rowSelector: '[role="option"]',
    onFocusChange: (id) => setFocusedRow(id ?? 'start.newSession')
  })

  const changedFiles = git?.files.length ?? 0
  const hasDiff = dirtyStat !== null && (dirtyStat.added > 0 || dirtyStat.removed > 0)

  // Most recent finished report across every thread, instance or subagent.
  const lastReport = [...threads]
    .filter((t) => t.report !== null)
    .sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))[0]

  // Law 4: an empty "nothing happened" line is worse than no section at all.
  const showSummary = hasDiff || lastReport !== undefined

  const newSession = getCommand('session.new.claude')
  const showChanges = getCommand('git.showChanges')

  const tab = (id: string): number => (focusedRow === id ? 0 : -1)

  return (
    <div className="start-panel">
      <div className="start-column" role="listbox" aria-label="Start" onKeyDown={onKeyDown}>
        <div className="start-header">
          <span className="project-name">{workspace?.name}</span>
          {workspace?.isGitRepo && git?.branch && (
            <span className="project-branch">
              <Icon name="branch" />
              {git.branch}
            </span>
          )}
        </div>

        {showSummary && (
          <div className="start-section" role="group" aria-label="Since you were last here">
            <div className="start-label" aria-hidden="true">
              Since you were last here
            </div>
            {hasDiff && (
              <button
                role="option"
                aria-selected="false"
                data-id="start.diff"
                tabIndex={tab('start.diff')}
                className="start-row"
                onClick={() => showChanges && void showChanges.run(useStore.getState())}
              >
                <span className="start-row-icon">
                  <Icon name="git" />
                </span>
                <span className="start-row-label">
                  {changedFiles} file{changedFiles === 1 ? '' : 's'} changed{' '}
                  <span className="start-row-diffstat">
                    <span className="diff-added">+{dirtyStat!.added}</span>{' '}
                    <span className="diff-removed">−{dirtyStat!.removed}</span>
                  </span>
                </span>
              </button>
            )}
            {lastReport && (
              <button
                role="option"
                aria-selected="false"
                data-id="start.report"
                tabIndex={tab('start.report')}
                className="start-row"
                onClick={() => setSidebar('agents')}
              >
                <span className="start-row-icon">
                  <Icon name="agents" />
                </span>
                <span className="start-row-label">{lastReport.title}</span>
                <span className="start-row-hint">
                  {age(lastReport.endedAt ?? lastReport.createdAt, null)} ago
                </span>
              </button>
            )}
          </div>
        )}

        {recentFiles.filter(isRecentableFile).length > 0 && (
          <div className="start-section" role="group" aria-label="Pick up where you left off">
            <div className="start-label" aria-hidden="true">
              Pick up where you left off
            </div>
            {recentFiles
              .filter(isRecentableFile)
              .slice(0, 5)
              .map((path) => {
                const parent = workspace ? parentLabel(path, workspace.root) : ''
                return (
                  <button
                    key={path}
                    role="option"
                    aria-selected="false"
                    data-id={path}
                    tabIndex={tab(path)}
                    className="start-row"
                    onClick={() => void openFile(path)}
                  >
                    <span className="start-row-icon">
                      <Icon name="file" />
                    </span>
                    <span className="start-row-label">{path.split('/').pop()}</span>
                    {parent && <span className="start-row-secondary">{parent}</span>}
                  </button>
                )
              })}
          </div>
        )}

        <div className="start-section" role="group" aria-label="Start">
          <div className="start-label" aria-hidden="true">
            Start
          </div>
          {newSession && (
            <button
              ref={startRowRef}
              role="option"
              aria-selected="false"
              data-id="start.newSession"
              tabIndex={tab('start.newSession')}
              className="start-row"
              onClick={() => void newSession.run(useStore.getState())}
            >
              <span className="start-row-icon">
                <Icon name="claude" />
              </span>
              <span className="start-row-label">{newSession.title}</span>
              {newSession.shortcut && <span className="start-row-hint">{newSession.shortcut}</span>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
