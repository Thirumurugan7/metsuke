import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import './onboarding.css'
import { useFocusTrap } from '../a11y/useFocusTrap'

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'

interface Section {
  id: string
  title: string
  body: JSX.Element
}

/**
 * The guide, written as flows rather than as a feature list.
 *
 * Someone opening this wants to know how to do a thing, not what the thing is called.
 * Each section is one job, in the order you would meet it.
 */
const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <>
        <p>
          Open a folder and a Claude session starts inside it, in the terminal panel at the
          bottom. That session already has the preview tools, so you can ask it to look at your
          running app straight away.
        </p>
        <p>
          By default it opens by walking the project once and reporting what it found. Turn that
          off under <b>＋ New</b> in the terminal panel if you would rather it stayed quiet.
        </p>
        <p className="guide-note">
          You need Claude Code installed and on your PATH. Everything else works without it.
        </p>
      </>
    )
  },
  {
    id: 'preview',
    title: 'Seeing your app',
    body: (
      <>
        <p>
          Start your dev server in the terminal as you normally would. The port appears in the
          Ports view on the left and in the strip under the preview, flagged as one you started.
          Click it to load the app in the preview pane.
        </p>
        <p>
          You can also type an address, or just a port number, into the preview's address bar.
          <b> ⛶</b> makes it fill the window and Escape brings the editor back.
        </p>
        <p className="guide-note">
          Databases and system services are hidden from the list, because loading one only ever
          gives you a blank page. "Show system ports" reveals them.
        </p>
      </>
    )
  },
  {
    id: 'select',
    title: 'Pointing at what is wrong',
    body: (
      <>
        <p>
          Press <b>Select</b> in the preview toolbar, then click any element on the page. The
          crosshair highlights as you hover, because it is Chromium's own inspector.
        </p>
        <p>
          A box opens with that element's selector and text. Write one line about what should
          change and press <kbd>{MOD}Enter</kbd>. It goes to the Claude terminal as a message with
          the selector attached, so it never has to guess which button you meant.
        </p>
      </>
    )
  },
  {
    id: 'test',
    title: 'Making Claude test the app',
    body: (
      <>
        <p>
          <b>⌕ Test UI</b> in the status bar starts a session that walks the running app on its
          own. It maps every screen it can reach, fills each form with real values and submits,
          retries with bad input to check your app actually refuses it, clicks the controls that
          do not submit, and reads the console after every step.
        </p>
        <p>
          You get back the screens it reached, a pass or fail for each flow, and the console and
          network evidence behind every failure. It also says what it could not get into.
        </p>
        <p className="guide-note">
          It does not edit anything. It reports what it would change and leaves the decision to
          you.
        </p>
      </>
    )
  },
  {
    id: 'git',
    title: 'Reviewing what changed',
    body: (
      <>
        <p>
          The Git view lists everything Claude touched, updating as it works. Click a file to read
          the diff, and switch between unstaged, staged and everything since the last commit.
        </p>
        <p>
          Stage, discard, commit, switch branches, push and pull all work here. It runs the real{' '}
          <code>git</code> binary, so your hooks and credentials behave exactly as they do in your
          terminal.
        </p>
      </>
    )
  },
  {
    id: 'terminals',
    title: 'Terminals',
    body: (
      <>
        <p>
          <b>＋ New</b> opens another Claude session or a plain shell. They live in tabs, and
          switching between them never kills anything.
        </p>
        <p>
          Sessions belong to the app rather than the window, so reloading reattaches to the
          running processes and replays what was on screen. Closing a tab is what ends a session.
        </p>
      </>
    )
  },
  {
    id: 'alerts',
    title: 'Being told when Claude needs you',
    body: (
      <>
        <p>
          When Claude asks permission or has been waiting, a small card appears above whatever app
          you are actually looking at, on whichever screen your cursor is on. It does not steal
          focus, so it will not interrupt your typing.
        </p>
        <p>
          Under <b>🔔 Alerts</b> you can also turn on a system notification, a sound of your
          choosing, or a Telegram message to your phone. Each one has a Test button.
        </p>
      </>
    )
  },
  {
    id: 'keys',
    title: 'Keyboard',
    body: (
      <table className="guide-keys">
        <tbody>
          <tr><td><kbd>{MOD}P</kbd></td><td>Go to file</td></tr>
          <tr><td><kbd>{MOD}S</kbd></td><td>Save</td></tr>
          <tr><td><kbd>{MOD}B</kbd></td><td>Toggle the sidebar</td></tr>
          <tr><td><kbd>{MOD}J</kbd></td><td>Toggle the terminal</td></tr>
          <tr><td><kbd>{MOD}W</kbd></td><td>Close the current tab</td></tr>
          <tr><td><kbd>{MOD}O</kbd></td><td>Open a folder</td></tr>
          <tr><td><kbd>{MOD}⇧E</kbd></td><td>Files</td></tr>
          <tr><td><kbd>{MOD}⇧G</kbd></td><td>Git</td></tr>
          <tr><td><kbd>{MOD}⇧F</kbd></td><td>Search</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Leave full screen, or cancel Select</td></tr>
        </tbody>
      </table>
    )
  }
]

export function Guide(): JSX.Element | null {
  const { guideOpen, setGuideOpen } = useStore()
  const dialog = useRef<HTMLDivElement>(null)
  useFocusTrap(dialog, guideOpen)
  const [active, setActive] = useState(SECTIONS[0].id)

  useEffect(() => {
    if (!guideOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setGuideOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [guideOpen, setGuideOpen])

  if (!guideOpen) return null
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]

  return (
    <div className="overlay guide-overlay" onMouseDown={() => setGuideOpen(false)}>
      <div
        ref={dialog}
        className="guide"
        role="dialog"
        aria-modal="true"
        aria-label="Guide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="guide-head">
          <h2>How to use this</h2>
          <button className="icon-only" aria-label="Close guide" onClick={() => setGuideOpen(false)}>
            ×
          </button>
        </div>

        <div className="guide-body">
          <nav className="guide-nav" aria-label="Guide sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={s.id === active ? 'on' : ''}
                aria-current={s.id === active}
                onClick={() => setActive(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <article className="guide-content">
            <h3>{section.title}</h3>
            {section.body}
          </article>
        </div>
      </div>
    </div>
  )
}
