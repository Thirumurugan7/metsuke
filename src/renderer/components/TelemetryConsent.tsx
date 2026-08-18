import { useStore } from '../state/store'
import './onboarding.css'

/**
 * The question, asked once, before anything has been sent.
 *
 * It floats over the app rather than living on the welcome screen, which is where it
 * started and where almost nobody would have seen it: the welcome screen only appears
 * with no folder open, and the editor reopens your last folder on launch. Consent would
 * have sat unasked forever for every returning user, which is not harmful, but it does
 * mean a feature that never works.
 *
 * On screen only when there is a destination configured and nobody has answered yet, so
 * a build with no endpoint never mentions telemetry at all. Both buttons are the same
 * size on purpose: "No thanks" is not a link in small grey text under a large blue
 * button, because that pattern is a way of asking without meaning it.
 *
 * The list is exhaustive. Everything the app can send is in the schema, and the schema
 * is the list below.
 */
export function TelemetryConsent(): JSX.Element | null {
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
