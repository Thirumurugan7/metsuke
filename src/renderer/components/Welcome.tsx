import { useEffect } from 'react'
import { useStore } from '../state/store'
import { Icon } from './Icon'
import './onboarding.css'

/**
 * What you see before a folder is open.
 *
 * The first job is answering "what is this", because the layout on its own does not.
 * The second is telling you if the one dependency is missing, before you open a folder
 * and get a terminal that dies without saying why.
 */
export function Welcome(): JSX.Element {
  const { systemCheck, loadSystemCheck, openFolder, setGuideOpen } = useStore()

  useEffect(() => {
    void loadSystemCheck()
  }, [loadSystemCheck])

  const missingClaude = systemCheck !== null && !systemCheck.claude.installed

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1 className="welcome-title">Metsuke</h1>
        <p className="welcome-lede">
          A code editor that runs Claude Code beside your project, and gives it a browser it can
          drive. You watch the work happen instead of reading a summary of it afterwards.
        </p>

        {missingClaude && (
          <div className="welcome-warn" role="alert">
            <b>Claude Code is not on your PATH.</b>
            <p>
              The editor runs the real <code>claude</code> command in its terminal, so that part
              will not work until it is installed. Everything else, the editor, git, the preview,
              works without it.
            </p>
            <p className="welcome-warn-fix">
              Install it, then reopen a folder and this check runs again.
            </p>
          </div>
        )}

        <ol className="welcome-steps">
          <li>
            <b>Open a folder.</b> A Claude session starts in it, already wired to the preview
            pane. It can begin by walking the project and telling you what it found.
          </li>
          <li>
            <b>Run your dev server</b> in the terminal. Its port shows up on its own, and one
            click loads it in the preview.
          </li>
          <li>
            <b>Point at what is wrong.</b> Hit Select in the preview, click any element, and write
            a line. Claude gets it with the exact selector attached.
          </li>
        </ol>

        <div className="welcome-actions">
          <button className="primary" onClick={() => void openFolder()}>
            Open a folder
          </button>
          <button className="labelled" onClick={() => setGuideOpen(true)}>
            Read the guide
          </button>
        </div>

        {systemCheck && (
          <p className="welcome-env">
            {systemCheck.claude.installed ? (
              <span className="ok welcome-claude">
                <Icon name="claude" />
                {/* `claude --version` prints "2.1.226 (Claude Code)", which would read
                    as "Claude Code 2.1.226 (Claude Code)" if shown whole. */}
                Claude Code {systemCheck.claude.version?.replace(/\s*\(.*\)\s*$/, '') ?? 'found'}
              </span>
            ) : (
              <span className="missing">Claude Code missing</span>
            )}
            <span className="sep">·</span>
            {systemCheck.git.installed ? (
              <span className="ok">git ready</span>
            ) : (
              <span className="missing">git missing, source control will be unavailable</span>
            )}
          </p>
        )}

        <p className="welcome-note">
          Metsuke is an independent open-source project, not affiliated with or endorsed by
          Anthropic. Claude and Claude Code are their trademarks, and running Claude Code here
          uses your own account with them.
        </p>
      </div>
    </div>
  )
}
