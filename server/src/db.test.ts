import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  getPool,
  migrate,
  insertEnvelope,
  summary,
  activeByDay,
  featureUsage,
  topErrors,
  breakdown,
  prune,
  readTicks,
  writeTicks,
  type Db
} from './db.js'
import type { TelemetryEnvelope, TelemetryEvent } from '../../src/shared/telemetry.js'

/*
 * These run against real Postgres, in a schema created and dropped per file.
 *
 * A mock would agree with whatever the queries do, which is worthless for the part most
 * likely to be wrong: the dialect. percentile_cont, FILTER, jsonb ->> and the timestamp
 * bucketing are the whole reason this file exists, and none of them can be checked
 * without a server that speaks them.
 */
const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)
const SCHEMA = `test_${randomBytes(4).toString('hex')}`

let db: Db

const envelope = (overrides: Partial<TelemetryEnvelope> = {}): TelemetryEnvelope => ({
  schema: 1,
  installId: 'install-a',
  sessionId: 'session-1',
  appVersion: '0.1.0',
  platform: 'darwin',
  arch: 'arm64',
  osVersion: '14',
  sentAt: NOW,
  events: [],
  ...overrides
})

const store = (events: TelemetryEvent[], env: Partial<TelemetryEnvelope> = {}, at = NOW): Promise<number> =>
  insertEnvelope(db, envelope(env), events, at, SCHEMA)

beforeAll(async () => {
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

describe('storage', () => {
  it('stores events and counts the install once', async () => {
    await store([
      { name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true },
      { name: 'folder_opened', isGitRepo: true }
    ])
    await store([{ name: 'folder_opened', isGitRepo: false }])

    expect((await summary(db, NOW, SCHEMA)).installs).toBe(1)
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}".events`)
    expect(rows[0].n).toBe(3)
  })

  /* The database should hold nothing that maps to a person or a place. */
  it('has no column for an address', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'events'`,
      [SCHEMA]
    )
    const columns = rows.map((r) => r.column_name as string)
    expect(columns).not.toContain('ip')
    expect(columns.join(' ')).not.toMatch(/addr|ip_/i)
  })

  it('keeps first_seen while moving last_seen forward', async () => {
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: false, gitInstalled: true }], {}, NOW - 10 * DAY)
    await store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], {}, NOW)

    const { rows } = await db.query(`SELECT first_seen, last_seen FROM "${SCHEMA}".installs`)
    expect(Number(rows[0].first_seen)).toBe(NOW - 10 * DAY)
    expect(Number(rows[0].last_seen)).toBe(NOW)
  })

  it('follows a version upgrade on the install row', async () => {
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { appVersion: '0.1.0' })
    await store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], { appVersion: '0.2.0' })

    expect(await breakdown(db, 'app_version', SCHEMA)).toEqual([{ value: '0.2.0', installs: 1 }])
  })

  it('rolls back a failed batch rather than storing half of it', async () => {
    await expect(
      // A null name violates NOT NULL partway through the transaction.
      store([{ name: 'folder_opened', isGitRepo: true }, { name: null } as unknown as TelemetryEvent])
    ).rejects.toThrow()

    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}".events`)
    expect(rows[0].n).toBe(0)
  })
})

describe('summary', () => {
  it('separates active installs from all installs', async () => {
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'old' }, NOW - 40 * DAY)
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'recent' }, NOW - 2 * DAY)

    const s = await summary(db, NOW, SCHEMA)
    expect(s.installs).toBe(2)
    expect(s.installsActive7d).toBe(1)
    expect(s.installsActive30d).toBe(1)
    expect(s.newInstalls7d).toBe(1)
  })

  it('reports the median session, not the mean', async () => {
    for (const seconds of [60, 120, 180, 240, 36_000]) {
      await store([{ name: 'app_closed', sessionSeconds: seconds }], { installId: `i-${seconds}` })
    }
    expect((await summary(db, NOW, SCHEMA)).medianSessionMinutes).toBe(3)
  })

  it('reports what share of launches found Claude Code', async () => {
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'a' })
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: false, gitInstalled: true }], { installId: 'b' })
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'c' })

    expect((await summary(db, NOW, SCHEMA)).claudeInstalledShare).toBeCloseTo(2 / 3)
  })

  it('says nothing rather than zero when there is nothing to report', async () => {
    const s = await summary(db, NOW, SCHEMA)
    expect(s.claudeInstalledShare).toBeNull()
    expect(s.medianSessionMinutes).toBe(0)
  })

  it('counts installs affected by errors, not just error volume', async () => {
    const error: TelemetryEvent = { name: 'error', kind: 'ipc', errorName: 'TypeError', message: 'boom' }
    await store([error, error, error], { installId: 'noisy' })
    await store([error], { installId: 'quiet' })

    const s = await summary(db, NOW, SCHEMA)
    expect(s.errors7d).toBe(4)
    expect(s.installsWithErrors7d).toBe(2)
  })
})

describe('breakdowns', () => {
  it('ranks features by how many installs used them, not raw clicks', async () => {
    await store(
      [
        { name: 'feature_used', feature: 'panel_git' },
        { name: 'feature_used', feature: 'panel_git' },
        { name: 'feature_used', feature: 'panel_git' }
      ],
      { installId: 'a' }
    )
    await store([{ name: 'feature_used', feature: 'quick_open' }], { installId: 'a' })
    await store([{ name: 'feature_used', feature: 'quick_open' }], { installId: 'b' })

    const features = await featureUsage(db, 30, NOW, SCHEMA)
    expect(features[0]).toMatchObject({ feature: 'quick_open', installs: 2, uses: 2 })
    expect(features[1]).toMatchObject({ feature: 'panel_git', installs: 1, uses: 3 })
  })

  it('groups identical errors and keeps a stack to look at', async () => {
    const error: TelemetryEvent = {
      name: 'error',
      kind: 'uncaught-exception',
      errorName: 'TypeError',
      message: 'cannot read channel',
      stack: 'at .../services/GitService.ts:40'
    }
    await store([error], { installId: 'a' })
    await store([error], { installId: 'b' })

    const errors = await topErrors(db, 30, 10, NOW, SCHEMA)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ errorName: 'TypeError', count: 2, installs: 2 })
    expect(errors[0].stack).toContain('GitService.ts')
  })

  it('buckets by when it happened, not when it arrived', async () => {
    await insertEnvelope(
      db,
      envelope({ installId: 'late' }),
      [{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true, at: NOW - 3 * DAY } as TelemetryEvent],
      NOW,
      SCHEMA
    )

    const days = await activeByDay(db, 30, NOW, SCHEMA)
    expect(days).toHaveLength(1)
    expect(days[0].day).toBe(new Date(NOW - 3 * DAY).toISOString().slice(0, 10))
  })

  it('falls back to arrival when the client clock is impossible', async () => {
    await insertEnvelope(
      db,
      envelope({ installId: 'timetraveller' }),
      [{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true, at: NOW + 400 * DAY } as TelemetryEvent],
      NOW,
      SCHEMA
    )

    const days = await activeByDay(db, 30, NOW, SCHEMA)
    expect(days[0].day).toBe(new Date(NOW).toISOString().slice(0, 10))
  })

  it('buckets activity by day', async () => {
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'a' }, NOW - DAY)
    await store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], { installId: 'a' }, NOW)
    await store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'b' }, NOW)

    const days = await activeByDay(db, 30, NOW, SCHEMA)
    expect(days).toHaveLength(2)
    expect(days[1]).toMatchObject({ installs: 2, launches: 2 })
  })
})

describe('retention', () => {
  it('deletes events past the window and keeps the install counts', async () => {
    await store([{ name: 'folder_opened', isGitRepo: true }], { installId: 'a' }, NOW - 200 * DAY)
    await store([{ name: 'folder_opened', isGitRepo: true }], { installId: 'a' }, NOW)

    expect(await prune(db, 180, NOW, SCHEMA)).toBe(1)
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${SCHEMA}".events`)
    expect(rows[0].n).toBe(1)
    expect((await summary(db, NOW, SCHEMA)).installs).toBe(1)
  })
})

describe('roadmap ticks', () => {
  it('starts empty rather than missing', async () => {
    expect(await readTicks(db, 'default', SCHEMA)).toEqual({ state: {}, updatedAt: 0 })
  })

  it('round-trips a tick', async () => {
    await writeTicks(db, { rename: true, license: true }, 'default', NOW, SCHEMA)
    const { state, updatedAt } = await readTicks(db, 'default', SCHEMA)
    expect(state).toEqual({ rename: true, license: true })
    expect(updatedAt).toBe(NOW)
  })

  it('replaces rather than merging, so unticking actually unticks', async () => {
    await writeTicks(db, { a: true, b: true }, 'default', NOW, SCHEMA)
    await writeTicks(db, { a: true }, 'default', NOW + 1, SCHEMA)
    expect((await readTicks(db, 'default', SCHEMA)).state).toEqual({ a: true })
  })
})
