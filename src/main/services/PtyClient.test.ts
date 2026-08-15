import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { PtyHost, type HostPty, type PtySpawner } from './PtyHost'
import { PtyClient } from './PtyClient'

/** Stands in for node-pty, which is built against Electron and will not load here. */
class FakePty implements HostPty {
  pid = 9001
  written: string[] = []
  killed = false
  #data: ((data: string) => void) | null = null
  #exit: ((event: { exitCode: number }) => void) | null = null

  write(data: string): void {
    this.written.push(data)
  }
  resize(): void {}
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
}

const TOKEN = 'shared-secret'
const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms))

let socketPath: string
let host: PtyHost
let ptys: FakePty[]
let spawner: PtySpawner

beforeEach(async () => {
  socketPath = path.join(os.tmpdir(), `mc-${Math.random().toString(36).slice(2, 8)}.sock`)
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
  await fs.rm(socketPath, { force: true })
})

function handlers(): {
  data: Array<[string, string]>
  exits: Array<[string, number]>
  lost: () => boolean
  handlers: Parameters<PtyClient['connect']>[2]
} {
  const data: Array<[string, string]> = []
  const exits: Array<[string, number]> = []
  let wasLost = false
  return {
    data,
    exits,
    lost: () => wasLost,
    handlers: {
      onData: (id, chunk) => data.push([id, chunk]),
      onExit: (id, code) => exits.push([id, code]),
      onLost: () => {
        wasLost = true
      }
    }
  }
}

const provisional = (id: string) => ({
  id,
  command: '/bin/zsh',
  cwd: '/tmp',
  kind: 'shell',
  title: 'zsh'
})

describe('PtyClient against a real host', () => {
  it('connects and reports nothing running on a fresh host', async () => {
    const h = handlers()
    const client = new PtyClient()
    await expect(client.connect(socketPath, TOKEN, h.handlers)).resolves.toEqual([])
    client.detach()
  })

  it('rejects a bad token rather than pretending to be connected', async () => {
    const client = new PtyClient()
    await expect(client.connect(socketPath, 'wrong', handlers().handlers)).rejects.toThrow(/refused/)
  })

  it('rejects when there is no host at that path', async () => {
    const client = new PtyClient()
    await expect(
      client.connect(path.join(os.tmpdir(), 'no-host-here.sock'), TOKEN, handlers().handlers)
    ).rejects.toThrow()
  })

  it('carries output and exit back to the editor', async () => {
    const h = handlers()
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, h.handlers)

    client.spawn('s1', {}, {}, provisional('s1'))
    await settle()
    ptys[0].emit('some output')
    await settle()

    expect(h.data).toEqual([['s1', 'some output']])

    ptys[0].kill()
    await settle()
    expect(h.exits).toEqual([['s1', 0]])
  })

  it('learns the pid from the host, since PortService needs it', async () => {
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, handlers().handlers)

    client.spawn('s1', {}, {}, provisional('s1'))
    expect(client.pids()).toEqual([]) // not known yet, and not guessed
    await settle()
    expect(client.pids()).toEqual([9001])

    client.detach()
  })

  it('keeps its own copy of scrollback so a renderer reload can replay it', async () => {
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, handlers().handlers)
    client.spawn('s1', {}, {}, provisional('s1'))
    await settle()

    ptys[0].emit('one ')
    ptys[0].emit('two')
    await settle()

    expect(client.history('s1')).toBe('one two')
    client.detach()
  })

  /*
   * The reason all of this exists. The first client is an editor that got restarted;
   * the second is the one that came back, and it never spawned anything.
   */
  it('picks up sessions started by a previous editor process', async () => {
    const first = new PtyClient()
    await first.connect(socketPath, TOKEN, handlers().handlers)
    first.spawn('kept', { title: 'claude' }, {}, provisional('kept'))
    await settle()
    ptys[0].emit('work in progress')
    await settle()

    first.detach()
    await settle()

    const second = new PtyClient()
    const restored = await second.connect(socketPath, TOKEN, handlers().handlers)

    expect(restored).toHaveLength(1)
    expect(restored[0].meta.id).toBe('kept')
    expect(restored[0].meta.title).toBe('claude')
    expect(restored[0].scrollback).toBe('work in progress')
    expect(second.history('kept')).toBe('work in progress')

    // And it can drive a terminal it did not start.
    second.write('kept', 'echo hi\r')
    await settle()
    expect(ptys[0].written).toEqual(['echo hi\r'])

    second.detach()
  })

  it('detaching leaves the sessions alone; shutdown ends them', async () => {
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, handlers().handlers)
    client.spawn('s1', {}, {}, provisional('s1'))
    await settle()

    client.detach()
    await settle()
    expect(host.sessionCount).toBe(1)
    expect(ptys[0].killed).toBe(false)

    const again = new PtyClient()
    await again.connect(socketPath, TOKEN, handlers().handlers)
    again.shutdown()
    await settle()
    expect(ptys[0].killed).toBe(true)
  })

  it('tells the editor when the host disappears, so it can fall back', async () => {
    const h = handlers()
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, h.handlers)

    host.close()
    await settle()

    expect(h.lost()).toBe(true)
    expect(client.connected).toBe(false)
  })

  it('drops writes after the host is gone instead of throwing at the caller', async () => {
    const client = new PtyClient()
    await client.connect(socketPath, TOKEN, handlers().handlers)
    host.close()
    await settle()

    expect(() => client.write('s1', 'ls\r')).not.toThrow()
    expect(() => client.kill('s1')).not.toThrow()
  })
})
