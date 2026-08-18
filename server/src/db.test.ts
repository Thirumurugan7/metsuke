import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase, insertEnvelope, summary, activeByDay, featureUsage, topErrors, breakdown, prune } from './db.js'
import type { TelemetryEnvelope, TelemetryEvent } from '../../src/shared/telemetry.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)

let dir: string
let db: Database.Database

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

const store = (events: TelemetryEvent[], env: Partial<TelemetryEnvelope> = {}, at = NOW): number =>
  insertEnvelope(db, envelope(env), events, at)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metsuke-db-'))
  db = openDatabase(path.join(dir, 'test.db'))
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('storage', () => {
  it('stores events and counts the install once', () => {
    store([
      { name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true },
      { name: 'folder_opened', isGitRepo: true }
    ])
    store([{ name: 'folder_opened', isGitRepo: false }])

    expect(summary(db, NOW).installs).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(3)
  })

  /* The database should hold nothing that maps to a person or a place. */
  it('has no column for an address', () => {
    const columns = (db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(columns).not.toContain('ip')
    expect(columns.join(' ')).not.toMatch(/addr|ip_/i)
  })

  it('keeps first_seen while moving last_seen forward', () => {
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: false, gitInstalled: true }], {}, NOW - 10 * DAY)
    store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], {}, NOW)

    const row = db.prepare('SELECT first_seen, last_seen FROM installs').get() as { first_seen: number; last_seen: number }
    expect(row.first_seen).toBe(NOW - 10 * DAY)
    expect(row.last_seen).toBe(NOW)
  })

  it('follows a version upgrade on the install row', () => {
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { appVersion: '0.1.0' })
    store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], { appVersion: '0.2.0' })

    expect(breakdown(db, 'app_version')).toEqual([{ value: '0.2.0', installs: 1 }])
  })
})

describe('summary', () => {
  it('separates active installs from all installs', () => {
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'old' }, NOW - 40 * DAY)
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'recent' }, NOW - 2 * DAY)

    const s = summary(db, NOW)
    expect(s.installs).toBe(2)
    expect(s.installsActive7d).toBe(1)
    expect(s.installsActive30d).toBe(1)
    expect(s.newInstalls7d).toBe(1)
  })

  /*
   * The median matters: one person who left it open over a weekend must not be able to
   * claim that everybody uses it for nine hours.
   */
  it('reports the median session, not the mean', () => {
    for (const seconds of [60, 120, 180, 240, 36_000]) {
      store([{ name: 'app_closed', sessionSeconds: seconds }], { installId: `i-${seconds}` })
    }
    expect(summary(db, NOW).medianSessionMinutes).toBe(3)
  })

  it('reports what share of launches found Claude Code', () => {
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'a' })
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: false, gitInstalled: true }], { installId: 'b' })
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'c' })

    expect(summary(db, NOW).claudeInstalledShare).toBeCloseTo(2 / 3)
  })

  it('says nothing rather than zero when there is nothing to report', () => {
    expect(summary(db, NOW).claudeInstalledShare).toBeNull()
    expect(summary(db, NOW).medianSessionMinutes).toBe(0)
  })

  it('counts installs affected by errors, not just error volume', () => {
    const error: TelemetryEvent = { name: 'error', kind: 'ipc', errorName: 'TypeError', message: 'boom' }
    store([error, error, error], { installId: 'noisy' })
    store([error], { installId: 'quiet' })

    const s = summary(db, NOW)
    expect(s.errors7d).toBe(4)
    expect(s.installsWithErrors7d).toBe(2)
  })
})

describe('breakdowns', () => {
  it('ranks features by how many installs used them, not raw clicks', () => {
    store(
      [
        { name: 'feature_used', feature: 'panel_git' },
        { name: 'feature_used', feature: 'panel_git' },
        { name: 'feature_used', feature: 'panel_git' }
      ],
      { installId: 'a' }
    )
    store([{ name: 'feature_used', feature: 'quick_open' }], { installId: 'a' })
    store([{ name: 'feature_used', feature: 'quick_open' }], { installId: 'b' })

    const features = featureUsage(db, 30, NOW)
    expect(features[0]).toMatchObject({ feature: 'quick_open', installs: 2, uses: 2 })
    expect(features[1]).toMatchObject({ feature: 'panel_git', installs: 1, uses: 3 })
  })

  it('groups identical errors and keeps a stack to look at', () => {
    const error: TelemetryEvent = {
      name: 'error',
      kind: 'uncaught-exception',
      errorName: 'TypeError',
      message: 'cannot read channel',
      stack: 'at .../services/GitService.ts:40'
    }
    store([error], { installId: 'a' })
    store([error], { installId: 'b' })

    const errors = topErrors(db, 30, 10, NOW)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ errorName: 'TypeError', count: 2, installs: 2 })
    expect(errors[0].stack).toContain('GitService.ts')
  })

  /*
   * Batches arrive late, so a week offline must not draw a spike on the day someone
   * reconnected and nothing on the days they were working.
   */
  it('buckets by when it happened, not when it arrived', () => {
    insertEnvelope(
      db,
      envelope({ installId: 'late' }),
      [{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true, at: NOW - 3 * DAY } as TelemetryEvent],
      NOW
    )

    const days = activeByDay(db, 30, NOW)
    expect(days).toHaveLength(1)
    expect(days[0].day).toBe(new Date(NOW - 3 * DAY).toISOString().slice(0, 10))
  })

  it('falls back to arrival when the client clock is impossible', () => {
    insertEnvelope(
      db,
      envelope({ installId: 'timetraveller' }),
      [{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true, at: NOW + 400 * DAY } as TelemetryEvent],
      NOW
    )

    const days = activeByDay(db, 30, NOW)
    expect(days[0].day).toBe(new Date(NOW).toISOString().slice(0, 10))
  })

  it('buckets activity by day', () => {
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'a' }, NOW - DAY)
    store([{ name: 'app_launched', firstRun: false, claudeInstalled: true, gitInstalled: true }], { installId: 'a' }, NOW)
    store([{ name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true }], { installId: 'b' }, NOW)

    const days = activeByDay(db, 30, NOW)
    expect(days).toHaveLength(2)
    expect(days[1]).toMatchObject({ installs: 2, launches: 2 })
  })
})

describe('retention', () => {
  it('deletes events past the window and keeps the install counts', () => {
    store([{ name: 'folder_opened', isGitRepo: true }], { installId: 'a' }, NOW - 200 * DAY)
    store([{ name: 'folder_opened', isGitRepo: true }], { installId: 'a' }, NOW)

    expect(prune(db, 180, NOW)).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(1)
    expect(summary(db, NOW).installs).toBe(1)
  })
})
