import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PtyHost, socketPathFor, type HostPty, type PtySpawner } from './PtyHost'
import { encode, decode, type Command, type Event } from './ptyProtocol'

/** A pty that does not exist: node-pty is built against Electron and will not load here. */
class FakePty implements HostPty {
  pid = 4242
  written: string[] = []
  size: { cols: number; rows: number } | null = null
  killed = false
  #data: ((data: string) => void) | null = null
  #exit: ((event: { exitCode: number }) => void) | null = null

  write(data: string): void {
    this.written.push(data)
  }
  resize(cols: number, rows: number): void {
    this.size = { cols, rows }
  }
  kill(): void {
    this.killed = true
    this.#exit?.({ exitCode: 0 })
  }
  onData(handler: (data: string) => void): void {
    this.#data = handler
  }
  onExit(handler: (event: { exitCode: number }) => void): void {
    this.#exit = handler
  }
  emit(data: string): void {
    this.#data?.(data)
  }
  finish(code: number): void {
    this.#exit?.({ exitCode: code })
  }
}

const TOKEN = 'test-token'

let dir: string
let socketPath: string
let host: PtyHost
let ptys: FakePty[]
let spawner: PtySpawner

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-host-'))
  // Short path: a unix socket address has to fit in 104 bytes.
  socketPath = path.join(os.tmpdir(), `mh-${Math.random().toString(36).slice(2, 8)}.sock`)
  ptys = []
  spawner = (opts) => {
    const pty = new FakePty()
    ptys.push(pty)
    return { pty, command: opts.command ?? '/bin/zsh', cwd: opts.cwd ?? '/tmp' }
  }
  host = new PtyHost(spawner, TOKEN)
  await host.listen(socketPath)
})

afterEach(async () => {
  host.close()
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(socketPath, { force: true })
})

/** A client that collects events, the way the editor's side does. */
async function connect(token = TOKEN): Promise<{
  socket: net.Socket
  events: Event[]
  send: (command: Command) => void
  next: (predicate: (event: Event) => boolean, timeout?: number) => Promise<Event>
}> {
  const socket = net.connect(socketPath)
  const events: Event[] = []
  let buffer = ''

  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    const decoded = decode<Event>(buffer + chunk)
    buffer = decoded.rest
    events.push(...decoded.messages)
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  const send = (command: Command): void => void socket.write(encode(command))

  const next = (predicate: (event: Event) => boolean, timeout = 2000): Promise<Event> =>
    new Promise((resolve, reject) => {
      const found = events.find(predicate)
      if (found) return resolve(found)
      const started = Date.now()
      const poll = setInterval(() => {
        const hit = events.find(predicate)
        if (hit) {
          clearInterval(poll)
          resolve(hit)
        } else if (Date.now() - started > timeout) {
          clearInterval(poll)
          reject(new Error(`timed out waiting; saw ${JSON.stringify(events)}`))
        }
      }, 5)
    })

  send({ op: 'hello', token })
  return { socket, events, send, next }
}

describe('PtyHost', () => {
  it('greets an authorised client with the sessions it already has', async () => {
    const client = await connect()
    const ready = await client.next((e) => e.ev === 'ready')
    expect(ready).toEqual({ ev: 'ready', sessions: [] })
  })

  /*
   * The socket can spawn processes as the user, so the token is the door. A wrong one is
   * refused before any other command is looked at.
   */
  it('refuses a client with the wrong token and takes nothing from it', async () => {
    const client = await connect('wrong')
    await client.next((e) => e.ev === 'denied')
    client.send({ op: 'spawn', id: 'x', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))
    expect(host.sessionCount).toBe(0)
  })

  it('spawns with the id the editor chose, so spawning can stay synchronous there', async () => {
    const client = await connect()
    await client.next((e) => e.ev === 'ready')

    client.send({ op: 'spawn', id: 'chosen-id', opts: { command: 'zsh' }, env: {} })
    await new Promise((r) => setTimeout(r, 50))

    ptys[0].emit('hello')
    const data = await client.next((e) => e.ev === 'data')
    expect(data).toEqual({ ev: 'data', id: 'chosen-id', data: 'hello' })
  })

  it('passes writes, resizes and kills through to the pty', async () => {
    const client = await connect()
    await client.next((e) => e.ev === 'ready')
    client.send({ op: 'spawn', id: 's', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))

    client.send({ op: 'write', id: 's', data: 'ls\r' })
    client.send({ op: 'resize', id: 's', cols: 120, rows: 40 })
    await new Promise((r) => setTimeout(r, 50))

    expect(ptys[0].written).toEqual(['ls\r'])
    expect(ptys[0].size).toEqual({ cols: 120, rows: 40 })

    client.send({ op: 'kill', id: 's' })
    await client.next((e) => e.ev === 'exit')
    expect(ptys[0].killed).toBe(true)
  })

  /*
   * The whole point. A new client is a main process that restarted, and it has to be
   * able to redraw a terminal it never spawned.
   */
  it('hands a reconnecting editor the running sessions and their scrollback', async () => {
    const first = await connect()
    await first.next((e) => e.ev === 'ready')
    first.send({ op: 'spawn', id: 'kept', opts: { title: 'claude' }, env: {} })
    await new Promise((r) => setTimeout(r, 50))
    ptys[0].emit('some output')
    await first.next((e) => e.ev === 'data')

    // The editor goes away, as it does on a restart.
    first.socket.destroy()
    await new Promise((r) => setTimeout(r, 50))
    expect(host.sessionCount).toBe(1)

    const second = await connect()
    const ready = (await second.next((e) => e.ev === 'ready')) as {
      sessions: Array<{ meta: { id: string; title: string }; scrollback: string; pid: number }>
    }
    expect(ready.sessions).toHaveLength(1)
    expect(ready.sessions[0].meta.id).toBe('kept')
    expect(ready.sessions[0].meta.title).toBe('claude')
    expect(ready.sessions[0].scrollback).toBe('some output')
    expect(ready.sessions[0].pid).toBe(4242)
  })

  it('keeps appending to scrollback for a session nobody is watching', async () => {
    const first = await connect()
    await first.next((e) => e.ev === 'ready')
    first.send({ op: 'spawn', id: 'kept', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))
    first.socket.destroy()
    await new Promise((r) => setTimeout(r, 50))

    ptys[0].emit('output while disconnected')

    const second = await connect()
    const ready = (await second.next((e) => e.ev === 'ready')) as {
      sessions: Array<{ scrollback: string }>
    }
    expect(ready.sessions[0].scrollback).toBe('output while disconnected')
  })

  it('tells every connected editor about output, not just the one that spawned it', async () => {
    const a = await connect()
    await a.next((e) => e.ev === 'ready')
    const b = await connect()
    await b.next((e) => e.ev === 'ready')

    a.send({ op: 'spawn', id: 'shared', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))
    ptys[0].emit('to both')

    await a.next((e) => e.ev === 'data')
    await b.next((e) => e.ev === 'data')
  })

  it('reports an exit and forgets the session', async () => {
    const client = await connect()
    await client.next((e) => e.ev === 'ready')
    client.send({ op: 'spawn', id: 'gone', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))

    ptys[0].finish(3)
    const exit = await client.next((e) => e.ev === 'exit')
    expect(exit).toEqual({ ev: 'exit', id: 'gone', exitCode: 3 })
    expect(host.sessionCount).toBe(0)
  })

  /*
   * Spawning is synchronous on the editor's side, so it already believes the session
   * exists. A failure has to arrive as an exit or the tab waits forever.
   */
  it('reports a spawn that throws as output and an exit', async () => {
    host.close()
    host = new PtyHost(() => {
      throw new Error('no such file or directory')
    }, TOKEN)
    await host.listen(socketPath)

    const client = await connect()
    await client.next((e) => e.ev === 'ready')
    client.send({ op: 'spawn', id: 'doomed', opts: { command: '/nope' }, env: {} })

    const data = (await client.next((e) => e.ev === 'data')) as { data: string }
    expect(data.data).toContain('no such file or directory')
    await client.next((e) => e.ev === 'exit')
  })

  it('ignores a duplicate spawn of the same id rather than leaking a second pty', async () => {
    const client = await connect()
    await client.next((e) => e.ev === 'ready')
    client.send({ op: 'spawn', id: 'twice', opts: {}, env: {} })
    client.send({ op: 'spawn', id: 'twice', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 80))

    expect(ptys).toHaveLength(1)
    expect(host.sessionCount).toBe(1)
  })

  it('kills everything on shutdown, which is what a real quit sends', async () => {
    const client = await connect()
    await client.next((e) => e.ev === 'ready')
    client.send({ op: 'spawn', id: 'doomed', opts: {}, env: {} })
    await new Promise((r) => setTimeout(r, 50))

    client.send({ op: 'shutdown' })
    await new Promise((r) => setTimeout(r, 80))

    expect(ptys[0].killed).toBe(true)
    expect(host.sessionCount).toBe(0)
  })

  it('takes over a socket file left behind by a host that died', async () => {
    // The first host is still listening on it; closing leaves the file in place.
    host.close()
    await new Promise((r) => setTimeout(r, 20))

    const second = new PtyHost(spawner, TOKEN)
    await expect(second.listen(socketPath)).resolves.toBeUndefined()
    second.close()
  })
})

describe('socketPathFor', () => {
  it('gives a dev run and an installed build different hosts', () => {
    const dev = socketPathFor('/Users/x/Library/Application Support/Metsuke (dev)')
    const packaged = socketPathFor('/Users/x/Library/Application Support/Metsuke')
    expect(dev).not.toBe(packaged)
  })

  it('is stable across calls, since that is how a restart finds its host again', () => {
    expect(socketPathFor('/a/b')).toBe(socketPathFor('/a/b'))
  })

  /*
   * sockaddr_un caps the path at 104 bytes on macOS, which a userData path in
   * "Library/Application Support" gets close to on its own.
   */
  it('stays well inside the length a unix socket path is allowed', () => {
    const long = socketPathFor('/Users/averyveryverylongusername/Library/Application Support/Metsuke (dev)')
    expect(long.length).toBeLessThan(100)
  })
})
