import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { TerminalSession, TerminalSpawnOptions } from '@shared/ipc'
import { encode, decode, type Command, type Event, type SessionState } from './ptyProtocol'

/** Roughly a few thousand lines — enough to restore context without hoarding memory. */
const MAX_SCROLLBACK = 256 * 1024

/** With no sessions and nobody connected, there is nothing left to be. */
const IDLE_EXIT_MS = 60_000

/** The minimum of a pty that this host needs. Narrow on purpose, so tests can fake it. */
export interface HostPty {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(handler: (data: string) => void): void
  onExit(handler: (event: { exitCode: number }) => void): void
}

export type PtySpawner = (
  opts: TerminalSpawnOptions,
  env: Record<string, string>
) => { pty: HostPty; command: string; cwd: string }

interface Session {
  meta: TerminalSession
  pty: HostPty
  scrollback: string
}

/**
 * The process that owns the ptys, so that they outlive the editor.
 *
 * A pty master is a file descriptor. It cannot be handed to another process or reopened
 * later, so as long as the editor's main process owned them, every restart of main ended
 * every terminal in the app: a `claude` session lost to a one-line change in a file it
 * was not even running from. Reload survived that already; restart did not.
 *
 * So the ptys live here instead, in a process the editor starts, connects to, and can
 * die without taking down. Reconnecting replays scrollback, which is why a restart looks
 * like a reload from the user's side rather than an empty pane.
 *
 * Killing sessions on a real quit is still correct, and stays deliberate: `shutdown` is
 * sent when somebody quits the app, and never when the process is simply going away.
 */
export class PtyHost {
  readonly #sessions = new Map<string, Session>()
  readonly #clients = new Set<net.Socket>()
  readonly #spawn: PtySpawner
  readonly #token: string
  #server: net.Server | null = null
  #idleTimer: NodeJS.Timeout | null = null
  #onEmpty: (() => void) | null = null

  constructor(spawner: PtySpawner, token: string) {
    this.#spawn = spawner
    this.#token = token
  }

  get sessionCount(): number {
    return this.#sessions.size
  }

  /** Called when the host has been idle long enough to be pointless. */
  onIdle(handler: () => void): void {
    this.#onEmpty = handler
  }

  async listen(socketPath: string): Promise<void> {
    // A socket file left behind by a host that died holds the address hostage.
    await removeStaleSocket(socketPath)

    this.#server = net.createServer((socket) => this.#accept(socket))

    await new Promise<void>((resolve, reject) => {
      this.#server!.once('error', reject)
      this.#server!.listen(socketPath, () => {
        this.#server!.removeListener('error', reject)
        resolve()
      })
    })

    // Belt and braces alongside the token: on a unix socket the filesystem is the
    // access check, and this one can spawn processes as the user.
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(socketPath, 0o600)
      } catch {
        // A socket that cannot be chmod'd still has the token in front of it.
      }
    }

    this.#armIdleTimer()
  }

  close(): void {
    for (const session of this.#sessions.values()) {
      try {
        session.pty.kill()
      } catch {
        // Already gone.
      }
    }
    this.#sessions.clear()
    for (const client of this.#clients) client.destroy()
    this.#clients.clear()
    this.#server?.close()
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
  }

  #accept(socket: net.Socket): void {
    let authorised = false
    let buffer = ''

    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      const { messages, rest } = decode<Command>(buffer + chunk)
      buffer = rest

      for (const message of messages) {
        if (!authorised) {
          // Nothing but hello is answered before the token checks out, so a process that
          // guessed the socket path cannot spawn anything with it.
          if (message.op !== 'hello' || message.token !== this.#token) {
            send(socket, { ev: 'denied' })
            socket.destroy()
            return
          }
          authorised = true
          this.#clients.add(socket)
          this.#cancelIdleTimer()
          send(socket, { ev: 'ready', sessions: this.#snapshot() })
          continue
        }

        this.#handle(socket, message)
      }
    })

    const drop = (): void => {
      this.#clients.delete(socket)
      // An editor that closed is not a reason to end anybody's session, but if there is
      // nothing left to serve there is no reason to stay running either.
      this.#armIdleTimer()
    }
    socket.on('close', drop)
    socket.on('error', drop)
  }

  #handle(socket: net.Socket, message: Command): void {
    switch (message.op) {
      case 'spawn':
        return this.#doSpawn(message.id, message.opts, message.env)
      case 'write':
        return void this.#sessions.get(message.id)?.pty.write(message.data)
      case 'resize':
        return void this.#sessions.get(message.id)?.pty.resize(message.cols, message.rows)
      case 'kill':
        return void this.#sessions.get(message.id)?.pty.kill()
      case 'sync':
        return send(socket, { ev: 'ready', sessions: this.#snapshot() })
      case 'shutdown':
        this.close()
        this.#onEmpty?.()
        return
      default:
        return
    }
  }

  #doSpawn(id: string, opts: TerminalSpawnOptions, env: Record<string, string>): void {
    if (this.#sessions.has(id)) return

    let spawned: ReturnType<PtySpawner>
    try {
      spawned = this.#spawn(opts, env)
    } catch (error) {
      // The editor already believes this session exists, because spawning is synchronous
      // on its side. An immediate exit is how it finds out otherwise.
      this.#broadcast({ ev: 'data', id, data: `\r\n${String(error)}\r\n` })
      this.#broadcast({ ev: 'exit', id, exitCode: 1 })
      return
    }

    const meta: TerminalSession = {
      id,
      command: spawned.command,
      cwd: spawned.cwd,
      kind: opts.kind ?? 'shell',
      title: opts.title ?? spawned.command
    }
    const session: Session = { meta, pty: spawned.pty, scrollback: '' }
    this.#sessions.set(id, session)
    this.#cancelIdleTimer()
    this.#broadcast({ ev: 'started', id, pid: spawned.pty.pid, meta })

    spawned.pty.onData((data) => {
      session.scrollback = (session.scrollback + data).slice(-MAX_SCROLLBACK)
      this.#broadcast({ ev: 'data', id, data })
    })
    spawned.pty.onExit(({ exitCode }) => {
      this.#sessions.delete(id)
      this.#broadcast({ ev: 'exit', id, exitCode })
      this.#armIdleTimer()
    })
  }

  #snapshot(): SessionState[] {
    return [...this.#sessions.values()].map((s) => ({
      meta: s.meta,
      scrollback: s.scrollback,
      pid: s.pty.pid
    }))
  }

  #broadcast(event: Event): void {
    for (const client of this.#clients) send(client, event)
  }

  #armIdleTimer(): void {
    this.#cancelIdleTimer()
    if (this.#sessions.size > 0 || this.#clients.size > 0) return
    this.#idleTimer = setTimeout(() => this.#onEmpty?.(), IDLE_EXIT_MS)
  }

  #cancelIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = null
  }
}

function send(socket: net.Socket, event: Event): void {
  if (socket.destroyed) return
  try {
    socket.write(encode(event))
  } catch {
    // A client that went away mid-write is handled by its close handler.
  }
}

/**
 * Clear a socket file whose host is gone.
 *
 * A unix socket left on disk by a crashed process is not automatically reclaimed: the
 * path is taken, and binding to it fails with EADDRINUSE even though nothing is
 * listening. Connecting first is the only way to tell those apart.
 */
async function removeStaleSocket(socketPath: string): Promise<void> {
  if (process.platform === 'win32') return
  if (!fs.existsSync(socketPath)) return

  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath)
    probe.once('connect', () => {
      probe.destroy()
      resolve(true)
    })
    probe.once('error', () => resolve(false))
  })

  if (!alive) fs.unlinkSync(socketPath)
}

/**
 * Where the host listens.
 *
 * Derived from the userData directory, so a dev run and an installed build get different
 * hosts for the same reason they get different userData: they are different apps that
 * happen to share a name. Hashed and put in the temp directory because a unix socket path
 * has to fit in 104 bytes, and "Library/Application Support/Metsuke (dev)" is most of
 * that before the filename.
 */
export function socketPathFor(userDataDir: string): string {
  const hash = createHash('sha256').update(userDataDir).digest('hex').slice(0, 12)
  if (process.platform === 'win32') return `\\\\.\\pipe\\metsuke-pty-${hash}`
  return path.join(os.tmpdir(), `metsuke-pty-${hash}.sock`)
}
