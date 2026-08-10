import os from 'node:os'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { TerminalSession, TerminalSpawnOptions } from '@shared/ipc'

interface Session {
  meta: TerminalSession
  proc: pty.IPty
}

/** The user's login shell, or a sane fallback per platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/zsh'
}

/**
 * Owns every pty in the app. Terminals are real ptys rather than piped child processes
 * so that `claude` gets a TTY and renders its interactive UI exactly as it does in a
 * normal terminal.
 */
export class TerminalService {
  readonly #sessions = new Map<string, Session>()
  #onData: ((id: string, data: string) => void) | null = null
  #onExit: ((id: string, exitCode: number) => void) | null = null

  /** Wire up the streams before spawning anything, so no early output is dropped. */
  listen(handlers: {
    onData: (id: string, data: string) => void
    onExit: (id: string, exitCode: number) => void
  }): void {
    this.#onData = handlers.onData
    this.#onExit = handlers.onExit
  }

  spawn(opts: TerminalSpawnOptions = {}): TerminalSession {
    const command = opts.command ?? defaultShell()
    const cwd = opts.cwd ?? os.homedir()
    const id = randomUUID()

    const proc = pty.spawn(command, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        // Tells `claude` and other TUIs they are talking to a capable terminal.
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Lets tools detect they are embedded, the way VS Code advertises itself.
        TERM_PROGRAM: 'codeeditor'
      }
    })

    const meta: TerminalSession = { id, command, cwd }
    this.#sessions.set(id, { meta, proc })

    proc.onData((data) => this.#onData?.(id, data))
    proc.onExit(({ exitCode }) => {
      this.#sessions.delete(id)
      this.#onExit?.(id, exitCode)
    })

    return meta
  }

  write(id: string, data: string): void {
    const session = this.#sessions.get(id)
    if (!session) throw new Error(`No such terminal: ${id}`)
    session.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.#sessions.get(id)
    if (!session) throw new Error(`No such terminal: ${id}`)
    // A zero dimension makes the pty layer throw; the renderer can briefly report one
    // while a panel is collapsed or mid-layout.
    if (cols < 1 || rows < 1) return
    session.proc.resize(cols, rows)
  }

  kill(id: string): void {
    const session = this.#sessions.get(id)
    if (!session) return
    session.proc.kill()
    this.#sessions.delete(id)
  }

  list(): TerminalSession[] {
    return [...this.#sessions.values()].map((s) => s.meta)
  }

  /** PIDs of every live pty, used by PortService to tell our servers from other ones. */
  pids(): number[] {
    return [...this.#sessions.values()].map((s) => s.proc.pid)
  }

  disposeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.kill(id)
    this.#onData = null
    this.#onExit = null
  }
}
