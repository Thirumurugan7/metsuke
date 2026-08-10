import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { call, useStore, type TerminalTab } from '../state/store'

/**
 * Multiple real ptys, one per tab.
 *
 * Every instance stays mounted and is merely hidden when inactive: unmounting would
 * destroy the pty along with its scrollback. Switching tabs used to kill the running
 * process outright, so choosing "shell" threw away your Claude session.
 */
export function TerminalPanel(): JSX.Element {
  const { terminals, activeTerminal, workspace, autoCheck, addTerminal, closeTerminal, setActiveTerminal, setAutoCheck, runProjectCheck } =
    useStore()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const close = (): void => setMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuOpen])

  return (
    <div className="terminal-panel">
      <div className="terminal-bar">
        <div className="terminal-tabs" role="tablist" aria-label="Terminals">
          {terminals.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTerminal}
              className={`terminal-tab${tab.id === activeTerminal ? ' active' : ''}`}
              onClick={() => setActiveTerminal(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) closeTerminal(tab.id)
              }}
              title={`${tab.title}${tab.exitCode !== null ? ` — exited (${tab.exitCode})` : ''}`}
            >
              <span className={`terminal-dot ${tab.exitCode !== null ? 'dead' : tab.kind}`} aria-hidden="true" />
              <span className="terminal-tab-name">{tab.title}</span>
              <button
                className="tab-close"
                aria-label={`Close ${tab.title}`}
                title="Close terminal"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(tab.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="terminal-actions">
          <div className="terminal-new">
            <button
              className="labelled"
              disabled={!workspace}
              title="Open another terminal"
              aria-label="New terminal"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
            >
              ＋ New ▾
            </button>
            {menuOpen && (
              <div className="terminal-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <button
                  role="menuitem"
                  onClick={() => {
                    addTerminal('claude')
                    setMenuOpen(false)
                  }}
                >
                  Claude session
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    addTerminal('shell')
                    setMenuOpen(false)
                  }}
                >
                  Shell
                </button>
                <div className="context-sep" />
                <button
                  role="menuitem"
                  onClick={() => {
                    runProjectCheck()
                    setMenuOpen(false)
                  }}
                >
                  Run project check
                </button>
                <label className="terminal-toggle">
                  <input
                    type="checkbox"
                    checked={autoCheck}
                    onChange={(e) => setAutoCheck(e.target.checked)}
                  />
                  Check project on open
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="terminal-body">
        {terminals.map((tab) => (
          <TerminalInstance key={tab.id} tab={tab} visible={tab.id === activeTerminal} />
        ))}

        {terminals.length === 0 && (
          <div className="terminal-overlay">
            <p>{workspace ? 'No terminals open' : 'No session running'}</p>
            {workspace ? (
              <button className="primary" onClick={() => addTerminal('claude')}>
                Start a Claude session
              </button>
            ) : (
              <button className="primary" onClick={() => void useStore.getState().openFolder()}>
                Open Folder
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** One xterm bound to one pty. Owns nothing outside its own tab. */
function TerminalInstance({ tab, visible }: { tab: TerminalTab; visible: boolean }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  /** Mirrors tab.sessionId without re-running the mount effect on every store change. */
  const session = useRef<string | null>(null)

  useEffect(() => {
    if (!host.current) return

    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      scrollback: 10_000,
      theme: { background: '#1a1a1a', foreground: '#d4d4d4' }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)

    term.current = terminal
    fit.current = fitAddon

    /** Fitting throws when the container has no layout, which is true while hidden. */
    const safeFit = (): void => {
      const element = host.current
      if (!element || element.clientWidth === 0 || element.clientHeight === 0) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      if (session.current) void call('terminal:resize', session.current, terminal.cols, terminal.rows)
    }

    const offData = window.api.on('terminal:data', (id, data) => {
      if (id === session.current) terminal.write(data)
    })
    const offExit = window.api.on('terminal:exit', (id, code) => {
      if (id !== session.current) return
      session.current = null
      useStore.getState().markTerminalExited(id, code)
      terminal.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
    })

    terminal.onData((data) => {
      if (session.current) void call('terminal:write', session.current, data)
    })

    const observer = new ResizeObserver(() => safeFit())
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      offData()
      offExit()
      if (session.current) void call('terminal:kill', session.current)
      terminal.dispose()
    }
  }, [])

  // Spawn when the tab has no live process — on first mount, and again after a restart.
  useEffect(() => {
    if (tab.sessionId || session.current || !term.current) return

    let cancelled = false
    const start = async (): Promise<void> => {
      const spawned = await call('terminal:spawn', {
        command: tab.kind === 'claude' ? 'claude' : undefined,
        // The prompt is passed as an argv entry, never through a shell, so quoting and
        // newlines in it cannot be reinterpreted as shell syntax.
        args: tab.kind === 'claude' && tab.prompt ? [tab.prompt] : undefined,
        cols: term.current?.cols ?? 80,
        rows: term.current?.rows ?? 24
      })
      if (!spawned) return

      // If the effect was torn down while the spawn was in flight — StrictMode's
      // double-mount does exactly this — the pty already exists and nothing will ever
      // own it. Bailing out without killing it leaked a live `claude` per mount.
      if (cancelled) {
        void call('terminal:kill', spawned.id)
        return
      }

      session.current = spawned.id
      useStore.getState().attachSession(tab.id, spawned.id)
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [tab.id, tab.sessionId, tab.kind, tab.prompt])

  // Refit when this tab becomes visible; it could not measure itself while hidden.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        /* container still has no layout */
      }
      term.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible])

  return (
    // Visibility via a class, not an inline `display`, so the flex column below is not
    // overridden and the exit banner can share height with the terminal.
    <div className={`terminal-instance${visible ? '' : ' hidden'}`}>
      {tab.exitCode !== null && (
        <div className="terminal-exited">
          <span>Process exited ({tab.exitCode})</span>
          <button className="labelled" onClick={() => useStore.getState().restartTerminal(tab.id)}>
            ↻ Restart
          </button>
        </div>
      )}
      <div ref={host} className="terminal-host" />
    </div>
  )
}
