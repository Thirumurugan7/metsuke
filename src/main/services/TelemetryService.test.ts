import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TelemetryService, type Transport } from './TelemetryService'

let dir: string
let sent: Array<{ endpoint: string; body: any }>
let transport: Transport
let failing = false

const CONFIG = {
  endpoint: 'https://telemetry.example/ingest',
  appVersion: '0.1.0',
  platform: 'darwin',
  arch: 'arm64',
  osVersion: '14',
  homeDir: '/Users/jane'
}

const service = (overrides: Partial<typeof CONFIG> = {}): TelemetryService =>
  new TelemetryService(dir, { ...CONFIG, ...overrides }, transport)

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-tel-'))
  sent = []
  failing = false
  transport = async (endpoint, body) => {
    sent.push({ endpoint, body: JSON.parse(body) })
    return { ok: !failing }
  }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('consent', () => {
  it('starts unasked, and sends nothing at all in that state', async () => {
    const t = service()
    await t.load()

    expect(t.consent).toBe('unasked')
    t.record({ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true })
    await t.flush()
    expect(sent).toHaveLength(0)
  })

  /*
   * The point of asking first: someone who says no should have sent nothing, not "one
   * install ping before the dialog appeared", which is the usual shape of this bug.
   */
  it('sends nothing after a refusal, and keeps nothing on disk', async () => {
    const t = service()
    await t.load()
    await t.setConsent(false)

    t.record({ name: 'folder_opened', isGitRepo: true })
    await t.flush()

    expect(sent).toHaveLength(0)
    await expect(fs.readdir(path.join(dir, 'telemetry'))).resolves.not.toContain('install-id')
  })

  it('sends once granted', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)

    t.record({ name: 'folder_opened', isGitRepo: true })
    await t.flush()

    expect(sent).toHaveLength(1)
    expect(sent[0].body.events[0].name).toBe('folder_opened')
  })

  it('remembers the answer across restarts', async () => {
    const first = service()
    await first.load()
    await first.setConsent(true)

    const second = service()
    await second.load()
    expect(second.consent).toBe('granted')
    expect(second.active).toBe(true)
  })

  it('forgets the install id when consent is withdrawn', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)
    const id = t.installId
    expect(id).toBeTruthy()

    await t.setConsent(false)
    expect(t.installId).toBeNull()

    // And a later yes is a new identity, not the old one resumed.
    await t.setConsent(true)
    expect(t.installId).not.toBe(id)
  })

  /*
   * The run in which somebody says yes should not be the one run that reports no launch.
   */
  it('tells the app when consent arrives, so the current launch can still be recorded', async () => {
    const t = service()
    let activated = 0
    t.onActivated(() => (activated += 1))
    await t.load()

    expect(activated).toBe(0)
    await t.setConsent(true)
    expect(activated).toBe(1)

    // Not on load of an already-granted install: that launch is recorded normally.
    const second = service()
    let again = 0
    second.onActivated(() => (again += 1))
    await second.load()
    expect(again).toBe(0)
  })

  it('is inert when no endpoint is configured, however consent stands', async () => {
    const t = service({ endpoint: '' })
    await t.load()
    await t.setConsent(true)

    t.record({ name: 'app_closed', sessionSeconds: 1 })
    await t.flush()
    expect(sent).toHaveLength(0)
  })
})

describe('what goes on the wire', () => {
  it('stamps the envelope with the environment and nothing about a person', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)
    t.record({ name: 'app_closed', sessionSeconds: 12 })
    await t.flush()

    const body = sent[0].body
    expect(body).toMatchObject({ appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', osVersion: '14' })
    expect(body.installId).toMatch(/[0-9a-f-]{36}/)
    expect(JSON.stringify(body)).not.toContain('jane')
  })

  it('scrubs an error before it is even queued', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)

    t.record({
      name: 'error',
      kind: 'uncaught-exception',
      errorName: 'Error',
      message: 'ENOENT /Users/jane/acme-confidential/notes.md',
      stack: 'at /Users/jane/acme-confidential/src/main/index.ts:4'
    })
    await t.flush()

    const wire = JSON.stringify(sent[0].body)
    expect(wire).not.toContain('acme-confidential')
    expect(wire).not.toContain('jane')
    // Still useful: our own file survives.
    expect(wire).toContain('index.ts')
  })

  it('refuses an event that is not in the schema', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)

    t.record({ name: 'file_contents', body: 'secret' } as never)
    await t.flush()
    expect(sent).toHaveLength(0)
  })
})

describe('delivery', () => {
  it('puts a rejected batch back rather than losing it', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)
    t.record({ name: 'folder_opened', isGitRepo: false })

    failing = true
    await t.flush()
    expect(sent).toHaveLength(1)

    failing = false
    await t.flush()
    expect(sent).toHaveLength(2)
    expect(sent[1].body.events[0].name).toBe('folder_opened')
  })

  it('survives a transport that throws', async () => {
    transport = async () => {
      throw new Error('offline')
    }
    const t = service()
    await t.load()
    await t.setConsent(true)
    t.record({ name: 'folder_opened', isGitRepo: false })

    await expect(t.flush()).resolves.toBeUndefined()
  })

  /* A queue that grows without limit is a disk leak on somebody else's machine. */
  it('drops the oldest events rather than growing forever', async () => {
    const t = service()
    await t.load()
    await t.setConsent(true)
    for (let i = 0; i < 700; i++) t.record({ name: 'app_closed', sessionSeconds: i })

    // Drain it: delivery is oldest first, in batches.
    for (let i = 0; i < 20; i++) await t.flush()

    const all = sent.flatMap((s) => s.body.events)
    expect(all.length).toBeLessThanOrEqual(500)

    const seconds = all.map((e: any) => e.sessionSeconds)
    // The newest are the ones kept, and the oldest are the ones dropped.
    expect(seconds).toContain(699)
    expect(seconds).not.toContain(0)
  })

  it('carries unsent events across a restart', async () => {
    const first = service()
    await first.load()
    await first.setConsent(true)
    first.record({ name: 'thread_created', mode: 'instance', worktree: true })

    failing = true
    await first.shutdown()
    failing = false

    const second = service()
    await second.load()
    await second.flush()

    const names = sent.flatMap((s) => s.body.events).map((e: any) => e.name)
    expect(names).toContain('thread_created')
  })

  it('ignores a queue file that has been tampered with', async () => {
    const first = service()
    await first.load()
    await first.setConsent(true)
    await fs.writeFile(
      path.join(dir, 'telemetry', 'queue.json'),
      JSON.stringify([{ name: 'exfiltrate', contents: 'whole repo' }]),
      'utf8'
    )

    const second = service()
    await second.load()
    await second.flush()
    expect(sent).toHaveLength(0)
  })
})
