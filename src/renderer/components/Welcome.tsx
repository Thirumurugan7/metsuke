import { useEffect } from 'react'
import { useStore } from '../state/store'
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
              <span className="ok">
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

        <TelemetryConsent />

        <p className="welcome-note">
          Metsuke is an independent open-source project, not affiliated with or endorsed by
          Anthropic. Claude and Claude Code are their trademarks, and running Claude Code here
          uses your own account with them.
        </p>
      </div>
    </div>
  )
}

/**
 * The question, asked once, before anything has been sent.
 *
 * On screen only when there is a destination configured and nobody has answered yet, so
 * a build with no endpoint never mentions telemetry at all. Both buttons are the same
 * size on purpose: "No thanks" is not a link in small grey text under a large blue
 * button, because that pattern is a way of asking without meaning it.
 *
 * The list is exhaustive. Everything the app can send is in the schema, and the schema
 * is the list below.
 */
function TelemetryConsent(): JSX.Element | null {
  const telemetry = useStore((s) => s.telemetry)
  const setTelemetryConsent = useStore((s) => s.setTelemetryConsent)

  if (!telemetry || !telemetry.configured || telemetry.consent !== 'unasked') return null

  return (
    <section className="consent" aria-labelledby="consent-title">
      <h2 className="consent-title" id="consent-title">
        Help work out what to fix?
      </h2>
      <p className="consent-lede">
        Metsuke can send anonymous usage and crash reports. It is off until you say
        otherwise, and you can change your mind in Settings at any time.
      </p>

      <div className="consent-cols">
        <div>
          <h3>What it sends</h3>
          <ul>
            <li>Launches, how long a run lasted, and which version and OS</li>
            <li>Whether Claude Code and git were found on your machine</li>
            <li>Which panels and features you use, as counts</li>
            <li>Errors and crashes, with the stack trace from our own code</li>
          </ul>
        </div>
        <div>
          <h3>What it never sends</h3>
          <ul>
            <li>Anything you or Claude wrote: no code, no prompts, no terminal output</li>
            <li>File paths, project names, repository names or URLs</li>
            <li>Your name, email, or anything that identifies you</li>
          </ul>
        </div>
      </div>

      <div className="consent-actions">
        <button className="primary" onClick={() => void setTelemetryConsent(true)}>
          Allow
        </button>
        <button className="labelled" onClick={() => void setTelemetryConsent(false)}>
          No thanks
        </button>
      </div>
    </section>
  )
}
