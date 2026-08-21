import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { getPool, migrate, type Db } from './db.js'
import {
  acceptEnvelope,
  authorised,
  validTickState,
  validAssigneeState,
  validTask,
  putTicks,
  putAssignees,
  postTask,
  removeTask,
  roadmapState,
  taskId,
  rateLimited
} from './handlers.js'

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
  await db.query(`TRUNCATE "${SCHEMA}".events, "${SCHEMA}".installs, "${SCHEMA}".roadmap_ticks, "${SCHEMA}".roadmap_tasks`)
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
    expect((await roadmapState(db)).ticks).toEqual({ rename: true })
  })

  it('rejects a bad body without touching what is stored', async () => {
    await putTicks({ state: { rename: true } }, Date.now(), db)
    await expect(putTicks({ state: 'everything' }, Date.now(), db)).resolves.toMatchObject({ status: 400 })
    expect((await roadmapState(db)).ticks).toEqual({ rename: true })
  })
})

describe('who is working on what', () => {
  it('accepts the two people and nobody', () => {
    expect(validAssigneeState({ a: 'thiru', b: 'prashant', c: null })).toBe(true)
  })

  /* A third name is a typo, not a new colleague, and storing it would show a task as
     assigned to somebody who does not exist. */
  it('refuses a name that is not one of them', () => {
    expect(validAssigneeState({ a: 'dave' })).toBe(false)
    expect(validAssigneeState({ a: 'THIRU' })).toBe(false)
    expect(validAssigneeState({ a: true })).toBe(false)
  })

  it('round-trips, and is kept apart from the ticks', async () => {
    await putTicks({ state: { rename: true } }, Date.now(), db)
    await putAssignees({ state: { rename: 'prashant' } }, Date.now(), db)

    const state = await roadmapState(db)
    expect(state.ticks).toEqual({ rename: true })
    expect(state.assignees).toEqual({ rename: 'prashant' })
  })

  it('can unassign by setting null', async () => {
    await putAssignees({ state: { rename: 'thiru' } }, Date.now(), db)
    await putAssignees({ state: { rename: null } }, Date.now(), db)
    expect((await roadmapState(db)).assignees).toEqual({ rename: null })
  })
})

describe('tasks added by hand', () => {
  it('creates one and gives it back with an id', async () => {
    const result = await postTask({ title: 'Buy a code signing certificate', assignee: 'thiru' }, Date.now(), db)
    expect(result.status).toBe(200)
    expect(result.task).toMatchObject({ title: 'Buy a code signing certificate', assignee: 'thiru', group: 'blocking' })
    expect(result.task!.id).toMatch(/^buy-a-code-signing-certificate-/)

    expect((await roadmapState(db)).tasks).toHaveLength(1)
  })

  /* Two people typing the same obvious title should not collide into one row. */
  it('gives two tasks with the same title different ids', () => {
    expect(taskId('Fix the thing', 1)).not.toBe(taskId('Fix the thing', 2))
  })

  it('refuses an empty or oversized title', async () => {
    await expect(postTask({ title: '   ' }, Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(postTask({ title: 'x'.repeat(200) }, Date.now(), db)).resolves.toMatchObject({ status: 400 })
    await expect(postTask({}, Date.now(), db)).resolves.toMatchObject({ status: 400 })
  })

  /* This endpoint takes free text, so the caps are the whole defence. */
  it('refuses a detail long enough to be a document', () => {
    expect(validTask({ title: 'fine', detail: 'x'.repeat(5000) })).toBe(false)
  })

  it('refuses an assignee who is not one of the two', async () => {
    await expect(postTask({ title: 'Something', assignee: 'someone-else' }, Date.now(), db)).resolves.toMatchObject({ status: 400 })
  })

  it('deletes one, and says so when there was nothing to delete', async () => {
    const created = await postTask({ title: 'Temporary' }, Date.now(), db)
    await expect(removeTask(created.task!.id, db)).resolves.toMatchObject({ status: 200 })
    expect((await roadmapState(db)).tasks).toHaveLength(0)

    await expect(removeTask(created.task!.id, db)).resolves.toMatchObject({ status: 404 })
  })

  it('refuses an id that is not one of ours rather than passing it to the database', async () => {
    await expect(removeTask("'; DROP TABLE roadmap_tasks; --", db)).resolves.toMatchObject({ status: 400 })
    await expect(removeTask(42, db)).resolves.toMatchObject({ status: 400 })
  })

  it('keeps assignment and ticks working on a task that is not in git', async () => {
    const created = await postTask({ title: 'Ship the thing', assignee: 'prashant' }, Date.now(), db)
    const id = created.task!.id

    await putTicks({ state: { [id]: true } }, Date.now(), db)
    const state = await roadmapState(db)

    expect(state.tasks[0].assignee).toBe('prashant')
    expect(state.ticks[id]).toBe(true)
  })
})
