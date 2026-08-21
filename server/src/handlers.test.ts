import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { getPool, migrate, type Db } from './db.js'
import { acceptEnvelope, authorised, validTickState, putTicks, getTicks, rateLimited } from './handlers.js'

/** The ingest boundary, against real Postgres, in a schema of its own. */
const SCHEMA = `test_${randomBytes(4).toString('hex')}`
let db: Db

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

beforeAll(async () => {
  process.env['DB_SCHEMA'] = SCHEMA
  db = getPool()
  await migrate(db, SCHEMA)
}, 30_000)

afterAll(async () => {
  await db.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await db.end()
})

beforeEach(async () => {
  await db.query(`TRUNCATE "${SCHEMA}".events, "${SCHEMA}".installs, "${SCHEMA}".roadmap_ticks`)
})

describe('ingest', () => {
  it('accepts a well-formed envelope', async () => {
    await expect(acceptEnvelope(envelope(), Date.now(), db)).resolves.toMatchObject({ status: 200, stored: 1 })
  })

  /*
   * The reason the server validates as well as the client: a client can be edited. The
   * schema is the agreement, and this is where it is enforced rather than trusted.
   */
  it('refuses an event the schema has never heard of', async () => {
    const result = await acceptEnvelope(envelope({ events: [{ name: 'file_contents', body: 'whole repo' }] }), Date.now(), db)
    expect(result.status).toBe(400)
    expect(result.stored).toBe(0)
  })

  it('keeps the good events out of a mixed batch and drops the rest', async () => {
    const result = await acceptEnvelope(
      envelope({
        events: [
          { name: 'folder_opened', isGitRepo: true },
          { name: 'exfiltrate', payload: 'secret' },
          { name: 'terminal_spawned', kind: 'shell' }
        ]
      }),
      Date.now(),
      db
    )
    expect(result).toMatchObject({ status: 200, stored: 2 })
  })

  it('rejects a schema version it does not understand', async () => {
    await expect(acceptEnvelope(envelope({ schema: 99 }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(acceptEnvelope(envelope({ schema: undefined }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
  })

  it('rejects a missing or oversized identifier', async () => {
    await expect(acceptEnvelope(envelope({ installId: '' }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(acceptEnvelope(envelope({ installId: 'x'.repeat(500) }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(acceptEnvelope(envelope({ platform: 42 }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
  })

  it('rejects an empty or absurd batch', async () => {
    await expect(acceptEnvelope(envelope({ events: [] }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(acceptEnvelope(envelope({ events: 'lots' }), Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(
      acceptEnvelope(envelope({ events: new Array(200).fill({ name: 'folder_opened', isGitRepo: true }) }), Date.now(), db)
    ).resolves.toMatchObject({ status: 400 })
  })

  it('rejects nonsense without throwing', async () => {
    for (const body of [null, 'hello', 42]) {
      await expect(acceptEnvelope(body, Date.now(), db)).resolves.toMatchObject({ status: 400 })
    }
  })
})

describe('dashboard auth', () => {
  it('accepts the token as a bearer or as a basic password', () => {
    expect(authorised('Bearer secret', 'secret')).toBe(true)
    expect(authorised(`Basic ${Buffer.from('any:secret').toString('base64')}`, 'secret')).toBe(true)
  })

  it('refuses everything else, including an unset token', () => {
    expect(authorised('Bearer wrong', 'secret')).toBe(false)
    expect(authorised(undefined, 'secret')).toBe(false)
    expect(authorised('Bearer anything', '')).toBe(false)
    expect(authorised('Token secret', 'secret')).toBe(false)
  })
})

describe('rate limiting', () => {
  it('lets a normal client through and stops a flood', () => {
    const address = `test-${randomBytes(3).toString('hex')}`
    let blocked = 0
    for (let i = 0; i < 200; i++) if (rateLimited(address)) blocked += 1
    expect(blocked).toBeGreaterThan(0)

    // A different address is unaffected by the first one's behaviour.
    expect(rateLimited(`other-${randomBytes(3).toString('hex')}`)).toBe(false)
  })
})

describe('roadmap ticks', () => {
  it('accepts a flat map of booleans', () => {
    expect(validTickState({ rename: true, license: false })).toBe(true)
  })

  /* It is a checklist, not a key-value store somebody found on the internet. */
  it('refuses anything else', () => {
    expect(validTickState({ rename: 'yes' })).toBe(false)
    expect(validTickState([true])).toBe(false)
    expect(validTickState(null)).toBe(false)
    expect(validTickState({ ['x'.repeat(200)]: true })).toBe(false)
    expect(validTickState(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, true])))).toBe(false)
  })

  it('round-trips through the database', async () => {
    await putTicks({ state: { rename: true } }, Date.now(), db)
    expect((await getTicks(db)).state).toEqual({ rename: true })
  })

  it('rejects a bad body without touching what is stored', async () => {
    await putTicks({ state: { rename: true } }, Date.now(), db)
    await expect(putTicks({ state: 'everything' }, Date.now(), db)).resolves.toMatchObject({ status: 400 })
    expect((await getTicks(db)).state).toEqual({ rename: true })
  })
})
