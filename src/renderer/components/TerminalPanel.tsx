import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { call, useStore, type TerminalTab } from '../state/store'
import { getTheme, onThemeChange, xtermTheme } from '../theme/apply'
import { getCommand } from '../state/commands'
import { Icon } from './Icon'
import { Modal } from './Modal'
import type { Thread } from '@shared/ipc'

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'

/** Plain sessions above the separator, prepared ones below — grammar within each group
 *  stays consistent (a noun you get vs. what it does), which is the whole fix for F2. */
const PLAIN_SESSION_IDS = ['session.new.claude', 'session.new.worktree', 'session.new.shell']
const PREPARED_SESSION_IDS = ['agent.checkProject', 'agent.testUi']

type DotState = 'running' | 'waiting' | 'idle' | 'pending' | 'dead'

/**
 * The dot used to show kind, duplicating the icon beside it, and collapsed every real
 * state into "not dead" (F6). Every `claude`-kind terminal is adopted as a `Thread` the
 * moment it spawns (see `ipc.ts`'s `terminal:spawn` handler), so the same hook-driven
 * `ThreadStatus` vocabulary `ThreadsPanel.tsx` already uses is available here too — no
 * second state model, no new plumbing. Shell tabs aren't threads, so they fall back to
 * the coarser live/pending/dead a plain pty can actually report.
 */
function dotState(tab: TerminalTab, threads: Thread[]): DotState {
  if (tab.exitCode !== null) return 'dead'
  if (tab.kind !== 'claude') return tab.sessionId ? 'running' : 'pending'

  const thread = threads.find((t) => t.terminalId === tab.sessionId)
  if (!thread) return tab.sessionId ? 'running' : 'pending'

  switch (thread.status) {
    case 'running':
      return 'running'
    case 'waiting':
      return 'waiting'
    case 'idle':
      return 'idle'
    // An instance thread only reaches these once its pty has already exited, which
    // `tab.exitCode` above already caught — kept for completeness, not reachability.
    case 'done':
    case 'failed':
      return 'dead'
  }
}

const DOT_LABEL: Record<DotState, string> = {
  running: 'running',
  waiting: 'waiting on you',
  idle: 'idle',
  pending: 'starting',
  dead: 'exited'
}

/**
 * Multiple real ptys, one per tab.
 *
 * Every instance stays mounted and is merely hidden when inactive: unmounting would
 * destroy the pty along with its scrollback. Switching tabs used to kill the running
 * process outright, so choosing "shell" threw away your Claude session.
 */
export function TerminalPanel(): JSX.Element {
  const {
    terminals,
    activeTerminal,
    workspace,
    addTerminal,
    closeTerminal,
    setActiveTerminal,
    renameTerminal,
    closeActiveTerminalRequest,
    threads
  } = useStore()
  const newButton = useRef<HTMLButtonElement>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // The one path every close goes through (M10) — the × button, ⌘W and middle-click
  // all call this rather than `closeTerminal` directly, so a live process is never
  // killed without whoever asked seeing the same confirmation.
  const [closeTarget, setCloseTarget] = useState<string | null>(null)
  const cancelCloseRef = useRef<HTMLButtonElement>(null)

  const requestClose = (id: string): void => {
    const tab = terminals.find((t) => t.id === id)
    if (tab && tab.sessionId !== null && tab.exitCode === null) setCloseTarget(id)
    else closeTerminal(id)
  }

  // ⌘W is global (App.tsx), so it reaches this confirmation through the same
  // request-nonce idiom other cross-component actions in this app use.
  const lastCloseRequest = useRef(closeActiveTerminalRequest)
  useEffect(() => {
    if (closeActiveTerminalRequest === lastCloseRequest.current) return
    lastCloseRequest.current = closeActiveTerminalRequest
    if (activeTerminal) requestClose(activeTerminal)
  }, [closeActiveTerminalRequest, activeTerminal])
  /**
   * Fixed-position anchor for the menu.
   *
   * The menu opens upward, out of the terminal panel — and the panel is clipped with
   * `overflow: hidden`, so an absolutely-positioned menu was drawn entirely outside its
   * clipping container — invisible and not even hit-testable. Positioning it fixed,
   * against viewport coordinates taken from the button, escapes every ancestor's
   * overflow.
   */
  const [menu, setMenu] = useState<{ right: number; bottom?: number; top?: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const toggleMenu = (): void => {
    if (menu) return setMenu(null)
    const rect = newButton.current?.getBoundingClientRect()
    if (!rect) return
    const right = window.innerWidth - rect.right
    // Normally opens upward. If the terminal has been dragged tall enough that there is
    // no room above, drop it downward instead rather than clipping at the viewport edge.
    const MENU_HEIGHT = 190
    setMenu(
      rect.top >= MENU_HEIGHT
        ? // Pinning the bottom means the menu's height need not be known in advance.
          { right, bottom: window.innerHeight - rect.top + 4 }
        : { right, top: rect.bottom + 4 }
    )
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-header">Sessions</div>
      <div className="terminal-bar">
        <div className="terminal-tabs" role="tablist" aria-label="Sessions">
          {terminals.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeTerminal}
              className={`terminal-tab${tab.id === activeTerminal ? ' active' : ''}`}
              onClick={() => setActiveTerminal(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) requestClose(tab.id)
              }}
              title={`${tab.prompt ?? tab.title}${tab.exitCode !== null ? ` — exited (${tab.exitCode})` : ''}`}
            >
              <span
                className={`terminal-dot ${dotState(tab, threads)}`}
                aria-label={DOT_LABEL[dotState(tab, threads)]}
              />
              <Icon name={tab.kind === 'claude' ? 'claude' : 'sessions'} />
              {renaming === tab.id ? (
                <input
                  className="terminal-tab-rename"
                  defaultValue={tab.title}
                  autoFocus
                  aria-label="Session name"
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameTerminal(tab.id, e.target.value)
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameTerminal(tab.id, (e.target as HTMLInputElement).value)
                      setRenaming(null)
                    }
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <span className="terminal-tab-name" onDoubleClick={() => setRenaming(tab.id)}>
                  {tab.title}
                </span>
              )}
              <button
                className="tab-close"
                aria-label={`Close ${tab.title}`}
                title={`Close session (${MOD}W)`}
                onClick={(e) => {
                  e.stopPropagation()
                  requestClose(tab.id)
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>

        <div className="terminal-actions">
          <div className="terminal-new">
            <button
              className="labelled split-primary"
              disabled={!workspace}
              title={workspace ? `Start a Claude session (${MOD}⇧N)` : 'Open a folder to start a session'}
              onClick={() => addTerminal('claude')}
            >
              <Icon name="add" /> New session
            </button>
            <button
              ref={newButton}
              className="icon-only split-caret"
              disabled={!workspace}
              title="More session types"
              aria-label="More session types"
              aria-expanded={menu !== null}
              onClick={(e) => {
                e.stopPropagation()
                toggleMenu()
              }}
            >
              <Icon name="chevronDown" />
            </button>
            {menu && (
              <div
                className="terminal-menu"
                role="menu"
                style={{ right: menu.right, bottom: menu.bottom, top: menu.top }}
                onClick={(e) => e.stopPropagation()}
              >
                {PLAIN_SESSION_IDS.map((id) => (
                  <MenuCommandItem key={id} id={id} onClose={() => setMenu(null)} />
                ))}
                <div className="context-sep" />
                {PREPARED_SESSION_IDS.map((id) => (
                  <MenuCommandItem key={id} id={id} onClose={() => setMenu(null)} />
                ))}
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
            <p>{workspace ? 'No sessions open' : 'No session running'}</p>
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

      {closeTarget && (
        <Modal
          variant="dialog"
          label="End this session?"
          onClose={() => setCloseTarget(null)}
          initialFocus={cancelCloseRef}
        >
          <h2 className="sheet-title">End this session?</h2>
          <p className="sheet-sub">
            <b>{terminals.find((t) => t.id === closeTarget)?.title}</b> is still running.
            Closing it ends the process. Anything it has not written to a file is lost.
          </p>
          <div className="sheet-foot">
            <div className="sheet-buttons">
              <button ref={cancelCloseRef} className="ghost" onClick={() => setCloseTarget(null)}>
                Cancel
              </button>
              <button
                className="danger"
                onClick={() => {
                  closeTerminal(closeTarget)
                  setCloseTarget(null)
                }}
              >
                End it
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * One row in the session menu, read straight from the command registry so its label
 * can never drift from what the same action is called in the command palette.
 */
function MenuCommandItem({ id, onClose }: { id: string; onClose: () => void }): JSX.Element | null {
  const state = useStore()
  const command = getCommand(id)
  if (!command) return null

  const blocked = command.when(state) ? null : (command.blockedBy?.(state) ?? null)

  return (
    <button
      role="menuitem"
      className="menu-command"
      disabled={blocked !== null}
      title={blocked ?? undefined}
      onClick={() => {
        void command.run(useStore.getState())
        onClose()
      }}
    >
      <Icon name={command.icon} />
      <span className="menu-command-title">{command.title}</span>
      {command.shortcut && <span className="menu-shortcut">{command.shortcut}</span>}
    </button>
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
      theme: xtermTheme(getTheme())
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

    /*
     * Fit synchronously, before the spawn effect (next in this same commit) reads
     * `terminal.cols`/`rows` to size the pty. Without this, the very first spawn used
     * xterm's constructor default (80x24) instead of the real container size, because
     * the ResizeObserver below does not deliver its first callback until the next
     * frame — Claude Code renders its startup box-drawing output against whatever
     * width the pty reports at that moment, and a later resize does not reflow output
     * already written, so a mismatch here is what actually mangled it. This was never
     * a missing listener or a debounce problem; the observer was already correctly
     * wired to the mount element.
     */
    try {
      fitAddon.fit()
    } catch {
      // No layout yet (rare on first mount) — the observer's first callback catches it.
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

    /*
     * xterm holds its own palette, including the sixteen ANSI colours, so it has to be
     * repainted explicitly when the theme changes.
     *
     * It has to be a partial assignment to `options`. Mutating `terminal.options.theme`
     * directly is silently discarded, because the getter hands back a copy: measured it
     * reading straight back as the old value. Spreading the whole options object instead
     * throws, since `cols` and `rows` are constructor-only.
     */
    const offTheme = onThemeChange((theme) => {
      terminal.options = { theme: xtermTheme(theme) }
    })

    // Debounced: a drag on the sessions/preview splitter fires this many times a
    // second, and each call both re-measures xterm's own layout and round-trips an IPC
    // resize to the pty — worth collapsing to one call after the drag settles rather
    // than on every intermediate frame.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(safeFit, 100)
    })
    observer.observe(host.current)

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      observer.disconnect()
      offTheme()
      offData()
      offExit()
      // Deliberately does not kill the pty. The session belongs to the app, not to this
      // component: closeTerminal kills it when you close the tab, adoption kills ones
      // left over from another folder, and quitting kills the rest. Killing here would
      // also destroy an adopted session during StrictMode's double-mount.
      terminal.dispose()
    }
  }, [])

  /*
   * Reattach to a session that outlived the renderer.
   *
   * The pty kept running through the reload, so the process is fine — but this xterm is
   * brand new and empty. Replaying the buffered output restores what was on screen,
   * including whatever Claude was in the middle of asking.
   */
  useEffect(() => {
    if (!tab.sessionId || session.current !== null || !term.current) return
    session.current = tab.sessionId

    void call('terminal:history', tab.sessionId).then((history) => {
      if (history && term.current) term.current.write(history)
    })
  }, [tab.sessionId])

  // Spawn when the tab has no live process — on first mount, and again after a restart.
  useEffect(() => {
    if (tab.sessionId || session.current || !term.current) return

    let cancelled = false
    const start = async (): Promise<void> => {
      const spawned = await call('terminal:spawn', {
        command: tab.kind === 'claude' ? 'claude' : tab.command,
        // The prompt/command args are passed as argv entries, never through a shell, so
        // quoting and newlines in them cannot be reinterpreted as shell syntax.
        args: tab.kind === 'claude' ? (tab.prompt ? [tab.prompt] : undefined) : tab.args,
        kind: tab.kind,
        title: tab.title,
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
            <Icon name="reload" /> Restart
          </button>
        </div>
      )}
      <div ref={host} className="terminal-host" />
    </div>
  )
}
