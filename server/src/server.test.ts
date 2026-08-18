import { describe, it, expect, beforeAll } from 'vitest'

// The module opens a database and, outside tests, refuses to start without a token.
process.env['NODE_ENV'] = 'test'
process.env['TELEMETRY_DB'] = ':memory:'

let acceptEnvelope: typeof import('./server.js')['acceptEnvelope']
let db: import('better-sqlite3').Database

beforeAll(async () => {
  const mod = await import('./server.js')
  acceptEnvelope = mod.acceptEnvelope
  db = mod.db
})

const envelope = (overrides: Record<string, unknown> = {}) => ({
  schema: 1,
  installId: 'install-a',
  sessionId: 'session-1',
  appVersion: '0.1.0',
  platform: 'darwin',
  arch: 'arm64',
  osVersion: '14',
  sentAt: Date.now(),
  events: [{ name: 'folder_opened', isGitRepo: true }],
  ...overrides
})

describe('ingest', () => {
  it('accepts a well-formed envelope', () => {
    const result = acceptEnvelope(envelope())
    expect(result).toMatchObject({ status: 200, stored: 1 })
  })

  /*
   * The reason the server validates as well as the client: a client can be edited. The
   * schema is the agreement, and this is where it is enforced rather than trusted.
   */
  it('refuses an event the schema has never heard of', () => {
    const result = acceptEnvelope(envelope({ events: [{ name: 'file_contents', body: 'whole repo' }] }))
    expect(result.status).toBe(400)
    expect(result.stored).toBe(0)
  })

  it('keeps the good events out of a mixed batch and drops the rest', () => {
    const result = acceptEnvelope(
      envelope({
        events: [
          { name: 'folder_opened', isGitRepo: true },
          { name: 'exfiltrate', payload: 'secret' },
          { name: 'terminal_spawned', kind: 'shell' }
        ]
      })
    )
    expect(result).toMatchObject({ status: 200, stored: 2 })
  })

  it('rejects a schema version it does not understand, rather than half-storing it', () => {
    expect(acceptEnvelope(envelope({ schema: 99 })).status).toBe(400)
    expect(acceptEnvelope(envelope({ schema: undefined })).status).toBe(400)
  })

  it('rejects a missing or oversized identifier', () => {
    expect(acceptEnvelope(envelope({ installId: '' })).status).toBe(400)
    expect(acceptEnvelope(envelope({ installId: 'x'.repeat(500) })).status).toBe(400)
    expect(acceptEnvelope(envelope({ platform: 42 })).status).toBe(400)
  })

  it('rejects an empty or absurd batch', () => {
    expect(acceptEnvelope(envelope({ events: [] })).status).toBe(400)
    expect(acceptEnvelope(envelope({ events: 'lots' })).status).toBe(400)
    expect(acceptEnvelope(envelope({ events: new Array(200).fill({ name: 'folder_opened', isGitRepo: true }) })).status).toBe(400)
  })

  it('rejects nonsense without throwing', () => {
    expect(acceptEnvelope(null).status).toBe(400)
    expect(acceptEnvelope('hello').status).toBe(400)
    expect(acceptEnvelope(42).status).toBe(400)
  })

  it('stores the environment from the envelope, not from the event', () => {
    acceptEnvelope(envelope({ installId: 'env-check', appVersion: '9.9.9', platform: 'win32' }))
    const row = db.prepare("SELECT app_version, platform FROM events WHERE install_id = 'env-check'").get() as {
      app_version: string
      platform: string
    }
    expect(row).toEqual({ app_version: '9.9.9', platform: 'win32' })
  })
})
