import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { call, useStore } from '../state/store'

/**
 * A real pty rendered with xterm.js. The default session runs `claude` in the open
 * folder, already wired to the preview MCP tools — which is the point of the editor.
 */
export function TerminalPanel(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const sessionId = useRef<string | null>(null)

  const workspace = useStore((s) => s.workspace)
  const [command, setCommand] = useState<'claude' | 'shell'>('claude')
  const [exited, setExited] = useState<number | null>(null)
  /** Bumped to force a respawn even when the command has not changed. */
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!host.current) return

    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cursorBlink: true,
      theme: { background: '#1a1a1a', foreground: '#d4d4d4' }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)

    term.current = terminal
    fit.current = fitAddon

    /**
     * Fitting throws if the container has no layout yet, which is the case on the
     * first paint and whenever the panel is collapsed. Guarding here rather than
     * chasing the one call site keeps every later resize safe too.
     */
    const safeFit = (): void => {
      const element = host.current
      if (!element || element.clientWidth === 0 || element.clientHeight === 0) return
      try {
        fitAddon.fit()
      } catch {
        return
      }
      if (sessionId.current) {
        void call('terminal:resize', sessionId.current, terminal.cols, terminal.rows)
      }
    }

    const offData = window.api.on('terminal:data', (id, data) => {
      if (id === sessionId.current) terminal.write(data)
    })
    const offExit = window.api.on('terminal:exit', (id, code) => {
      if (id !== sessionId.current) return
      sessionId.current = null
      setExited(code)
      terminal.write(`\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
    })

    terminal.onData((data) => {
      if (sessionId.current) void call('terminal:write', sessionId.current, data)
    })

    // A ResizeObserver catches panel toggles and drags, which a window resize listener
    // misses entirely, and fires once the container first gets a size.
    const observer = new ResizeObserver(() => safeFit())
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      offData()
      offExit()
      if (sessionId.current) void call('terminal:kill', sessionId.current)
      terminal.dispose()
    }
  }, [])

  // Spawn once a folder is open, and respawn when the user switches command.
  useEffect(() => {
    if (!workspace || !term.current) return

    const start = async (): Promise<void> => {
      if (sessionId.current) {
        await call('terminal:kill', sessionId.current)
        sessionId.current = null
      }
      term.current?.clear()
      setExited(null)

      const session = await call('terminal:spawn', {
        command: command === 'claude' ? 'claude' : undefined,
        cwd: workspace.root,
        cols: term.current?.cols ?? 80,
        rows: term.current?.rows ?? 24
      })
      if (session) sessionId.current = session.id
    }

    void start()
  }, [workspace, command, generation])

  return (
    <div className="terminal-panel">
      <div className="terminal-bar">
        <button className={command === 'claude' ? 'active' : ''} onClick={() => setCommand('claude')}>
          claude
        </button>
        <button className={command === 'shell' ? 'active' : ''} onClick={() => setCommand('shell')}>
          shell
        </button>
        {exited !== null && (
          <button className="restart" onClick={() => setGeneration((g) => g + 1)}>
            restart
          </button>
        )}
        <span className="terminal-hint">
          {command === 'claude' ? 'preview tools attached' : workspace?.root ?? ''}
        </span>
      </div>
      <div ref={host} className="terminal-host" />
    </div>
  )
}
