import os from 'node:os'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { TerminalSession, TerminalSpawnOptions } from '@shared/ipc'
import { PtyClient } from './PtyClient'

interface Session {
  meta: TerminalSession
  proc: pty.IPty
  /**
   * Recent output, so a renderer that reloads can redraw the terminal instead of
   * showing an empty pane attached to a live process.
   */
  scrollback: string
}

/** Roughly a few thousand lines — enough to restore context without hoarding memory. */
const MAX_SCROLLBACK = 256 * 1024

/** The user's login shell, or a sane fallback per platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/zsh'
}

/**
 * Every pty in the app, wherever it happens to live.
 *
 * Ptys run in a separate host process so they outlive a restart of main: a pty master is
 * a file descriptor, and a descriptor cannot be handed over or reopened, so anything main
 * owns dies with main. See PtyHost.
 *
 * When the host is unavailable this falls back to spawning them here, which is what it
 * always did. That path is not a formality: it is the difference between "terminals do
 * not survive a restart" and "terminals do not work", and only one of those is worth
 * shipping.
 *
 * The API is deliberately unchanged and still synchronous. `spawn` picks the session id
 * itself and hands the session back without waiting for the host, so no caller has to
 * know which of the two is in use.
 */
export class TerminalService {
  readonly #sessions = new Map<string, Session>()
  #client: PtyClient | null = null
  /**
   * Extra environment for every pty. Carries the control-bridge URL and token so that
   * Claude Code's hooks can call back into the editor — keeping the token out of the
   * settings file on disk.
   */
  #env: Record<string, string> = {}
  #onData: ((id: string, data: string) => void) | null = null
  #onExit: ((id: string, exitCode: number) => void) | null = null

  /** Environment added to every pty this service spawns. */
  setEnv(env: Record<string, string>): void {
    this.#env = env
  }

  /** Wire up the streams before spawning anything, so no early output is dropped. */
  listen(handlers: {
    onData: (id: string, data: string) => void
    onExit: (id: string, exitCode: number) => void
  }): void {
    this.#onData = handlers.onData
    this.#onExit = handlers.onExit
  }

  /**
   * Attach to the pty host, adopting whatever it is already running.
   *
   * Returns the sessions that came back from a previous run of the editor. Anything that
   * throws here is answered by carrying on without a host.
   */
  async attach(socketPath: string, token: string): Promise<TerminalSession[]> {
    const client = new PtyClient()

    const restored = await client.connect(socketPath, token, {
      onData: (id, data) => this.#onData?.(id, data),
      onExit: (id, exitCode) => this.#onExit?.(id, exitCode),
      onLost: () => {
        // Sessions keep running in the host; this process just cannot see them any more.
        // New terminals go to local ptys until the next launch reconnects.
        console.error('[terminals] lost the pty host; new sessions will run in-process')
        this.#client = null
      }
    })

    this.#client = client
    return restored.map((state) => state.meta)
  }

  /** True when ptys are running somewhere that a restart of this process cannot kill. */
  get hosted(): boolean {
    return this.#client?.connected ?? false
  }

  spawn(opts: TerminalSpawnOptions = {}): TerminalSession {
    const command = opts.command ?? defaultShell()
    const cwd = opts.cwd ?? os.homedir()
    const id = randomUUID()

    const meta: TerminalSession = {
      id,
      command,
      cwd,
      kind: opts.kind ?? 'shell',
      title: opts.title ?? command
    }

    if (this.#client?.connected) {
      // The host resolves the same defaults from the same environment, and corrects this
      // metadata when it reports the spawn.
      this.#client.spawn(id, opts, this.#env, meta)
      return meta
    }

    const proc = pty.spawn(command, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        ...this.#env,
        // Tells `claude` and other TUIs they are talking to a capable terminal.
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Lets tools detect they are embedded, the way VS Code advertises itself.
        TERM_PROGRAM: 'metsuke'
      }
    })

    const session: Session = { meta, proc, scrollback: '' }
    this.#sessions.set(id, session)

    proc.onData((data) => {
      session.scrollback = (session.scrollback + data).slice(-MAX_SCROLLBACK)
      this.#onData?.(id, data)
    })
    proc.onExit(({ exitCode }) => {
      this.#sessions.delete(id)
      this.#onExit?.(id, exitCode)
    })

    return meta
  }

  write(id: string, data: string): void {
    const session = this.#sessions.get(id)
    if (session) return session.proc.write(data)
    if (this.#client?.connected) return this.#client.write(id, data)
    throw new Error(`No such terminal: ${id}`)
  }

  resize(id: string, cols: number, rows: number): void {
    // A zero dimension makes the pty layer throw; the renderer can briefly report one
    // while a panel is collapsed or mid-layout.
    if (cols < 1 || rows < 1) return

    const session = this.#sessions.get(id)
    if (session) return session.proc.resize(cols, rows)
    if (this.#client?.connected) return this.#client.resize(id, cols, rows)
    throw new Error(`No such terminal: ${id}`)
  }

  kill(id: string): void {
    const session = this.#sessions.get(id)
    if (session) {
      session.proc.kill()
      this.#sessions.delete(id)
      return
    }
    this.#client?.kill(id)
  }

  list(): TerminalSession[] {
    return [
      ...[...this.#sessions.values()].map((s) => s.meta),
      ...(this.#client?.sessions.map((s) => s.meta) ?? [])
    ]
  }

  /** Buffered output, replayed by a renderer reattaching after a reload. */
  history(id: string): string {
    const local = this.#sessions.get(id)
    if (local) return local.scrollback
    return this.#client?.history(id) ?? ''
  }

  /** PIDs of every live pty, used by PortService to tell our servers from other ones. */
  pids(): number[] {
    return [...[...this.#sessions.values()].map((s) => s.proc.pid), ...(this.#client?.pids() ?? [])]
  }

  /**
   * Kill every session but keep the stream handlers wired.
   *
   * This is what a renderer reload needs: the ptys it owned must die, but `listen` is
   * called once at startup, so dropping the handlers here would leave the *next*
   * renderer with terminals that never emit output.
   */
  killAll(): void {
    for (const id of [...this.#sessions.keys()]) this.kill(id)
    for (const session of this.#client?.sessions ?? []) this.#client?.kill(session.meta.id)
  }

  /**
   * Full teardown for a real quit: kill everything, including the host.
   *
   * Only ever called from the quit path. A process that is merely going away — a
   * restart, a crash, a dev rebuild — must not reach this, or the host would take the
   * user's sessions with it and there would be nothing left to survive.
   */
  disposeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.kill(id)
    this.#client?.shutdown()
    this.#client = null
    this.#onData = null
    this.#onExit = null
  }
}
