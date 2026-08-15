import net from 'node:net'
import type { TerminalSession, TerminalSpawnOptions } from '@shared/ipc'
import { encode, decode, type Command, type Event } from './ptyProtocol'

/** How long to wait for the host to answer `hello` before giving up on it. */
const HANDSHAKE_MS = 5_000

export interface ClientSession {
  meta: TerminalSession
  scrollback: string
  pid: number
}

export interface ClientHandlers {
  onData: (id: string, data: string) => void
  onExit: (id: string, exitCode: number) => void
  /** The connection dropped. The editor falls back so terminals still work. */
  onLost: () => void
}

/**
 * The editor's end of the pty host.
 *
 * Everything here is fire and forget except connecting, which is what keeps
 * TerminalService's API synchronous: the caller picks the session id, so a terminal can
 * be handed back before the host has answered, exactly as it was when the pty lived in
 * this process. The host corrects the details it alone knows, the pid and the resolved
 * shell, with `started`.
 */
export class PtyClient {
  #socket: net.Socket | null = null
  #buffer = ''
  #handlers: ClientHandlers | null = null
  readonly #sessions = new Map<string, ClientSession>()

  get sessions(): ClientSession[] {
    return [...this.#sessions.values()]
  }

  get connected(): boolean {
    return this.#socket !== null && !this.#socket.destroyed
  }

  /**
   * Connect and take delivery of whatever is already running.
   *
   * Resolves with the sessions the host is holding, which after a restart of the editor
   * is the whole point: they are terminals this process never spawned.
   */
  async connect(socketPath: string, token: string, handlers: ClientHandlers): Promise<ClientSession[]> {
    this.#handlers = handlers

    const socket = net.connect(socketPath)
    socket.setEncoding('utf8')

    const ready = new Promise<ClientSession[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pty host did not answer')), HANDSHAKE_MS)

      const onError = (error: Error): void => {
        clearTimeout(timer)
        reject(error)
      }
      socket.once('error', onError)

      socket.on('data', (chunk: string) => {
        const { messages, rest } = decode<Event>(this.#buffer + chunk)
        this.#buffer = rest

        for (const message of messages) {
          if (message.ev === 'ready') {
            clearTimeout(timer)
            socket.removeListener('error', onError)
            this.#sessions.clear()
            for (const state of message.sessions) this.#sessions.set(state.meta.id, { ...state })
            resolve(this.sessions)
            continue
          }
          if (message.ev === 'denied') {
            clearTimeout(timer)
            reject(new Error('pty host refused the token'))
            return
          }
          this.#receive(message)
        }
      })
    })

    /*
     * Two things can reject here: the connection itself, and the handshake. Whichever
     * loses the race would otherwise look like an unhandled rejection, and a missing host
     * is the ordinary case, not an exceptional one: it is how the editor decides to fall
     * back to running ptys itself. Marking it handled changes nothing for the caller,
     * which still awaits the same promise below.
     */
    void ready.catch(() => {})

    socket.on('close', () => this.#lost())
    socket.on('error', () => this.#lost())

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    this.#socket = socket
    this.#send({ op: 'hello', token })

    return ready
  }

  spawn(id: string, opts: TerminalSpawnOptions, env: Record<string, string>, provisional: TerminalSession): void {
    // Recorded before the host answers, because the caller already has this session in
    // hand. `started` replaces it with the host's version.
    this.#sessions.set(id, { meta: provisional, scrollback: '', pid: 0 })
    this.#send({ op: 'spawn', id, opts, env })
  }

  write(id: string, data: string): void {
    this.#send({ op: 'write', id, data })
  }

  resize(id: string, cols: number, rows: number): void {
    this.#send({ op: 'resize', id, cols, rows })
  }

  kill(id: string): void {
    this.#send({ op: 'kill', id })
  }

  history(id: string): string {
    return this.#sessions.get(id)?.scrollback ?? ''
  }

  pids(): number[] {
    return this.sessions.map((s) => s.pid).filter((pid) => pid > 0)
  }

  /** Kill everything and stop the host. Sent when somebody quits, never on a restart. */
  shutdown(): void {
    this.#send({ op: 'shutdown' })
    this.#sessions.clear()
    this.#socket?.end()
    this.#socket = null
  }

  /** Drop the connection without touching the sessions, which keep running. */
  detach(): void {
    this.#handlers = null
    this.#socket?.destroy()
    this.#socket = null
  }

  #receive(message: Event): void {
    switch (message.ev) {
      case 'started': {
        const session = this.#sessions.get(message.id)
        this.#sessions.set(message.id, {
          meta: message.meta,
          scrollback: session?.scrollback ?? '',
          pid: message.pid
        })
        return
      }
      case 'data': {
        const session = this.#sessions.get(message.id)
        if (session) session.scrollback = (session.scrollback + message.data).slice(-256 * 1024)
        this.#handlers?.onData(message.id, message.data)
        return
      }
      case 'exit': {
        this.#sessions.delete(message.id)
        this.#handlers?.onExit(message.id, message.exitCode)
        return
      }
      default:
        return
    }
  }

  #lost(): void {
    if (!this.#socket) return
    this.#socket = null
    const handlers = this.#handlers
    this.#handlers = null
    handlers?.onLost()
  }

  #send(command: Command): void {
    if (!this.#socket || this.#socket.destroyed) return
    try {
      this.#socket.write(encode(command))
    } catch {
      // The close handler deals with a socket that has gone.
    }
  }
}
