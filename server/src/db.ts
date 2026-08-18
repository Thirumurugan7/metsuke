import Database from 'better-sqlite3'
import type { TelemetryEnvelope, TelemetryEvent } from '../../src/shared/telemetry.js'

/**
 * Storage for usage reporting.
 *
 * SQLite rather than Postgres on purpose. This is one box serving a desktop app's worth
 * of events: a file is the whole deployment, a backup is a copy, and there is no second
 * service to keep alive at three in the morning. If it ever outgrows that, the queries
 * below are ordinary SQL and the move is mechanical.
 *
 * Two things are deliberately not stored. There is no IP column: the address is used to
 * rate limit and then dropped, so the database holds nothing that maps to a person or a
 * place. And there is no raw envelope blob, because keeping "the original just in case"
 * is how data nobody agreed to ends up on disk anyway.
 */
export interface StoredEvent {
  id: number
  installId: string
  sessionId: string
  name: string
  /** The event's own fields, minus the name. Validated against the schema first. */
  props: Record<string, unknown>
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  /** Client clock. */
  at: number
  /** Server clock, which is the one to trust for anything time-ordered. */
  receivedAt: number
}

export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      install_id  TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      props       TEXT NOT NULL,
      app_version TEXT NOT NULL,
      platform    TEXT NOT NULL,
      arch        TEXT NOT NULL,
      os_version  TEXT NOT NULL,
      at          INTEGER NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS events_received ON events (received_at);
    CREATE INDEX IF NOT EXISTS events_name     ON events (name, received_at);
    CREATE INDEX IF NOT EXISTS events_install  ON events (install_id, received_at);

    /* One row per install, so "how many people" does not mean scanning every event. */
    CREATE TABLE IF NOT EXISTS installs (
      install_id  TEXT PRIMARY KEY,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      platform    TEXT NOT NULL,
      arch        TEXT NOT NULL,
      os_version  TEXT NOT NULL
    );
  `)

  return db
}

/** Write one envelope's worth of events. Returns how many were stored. */
export function insertEnvelope(
  db: Database.Database,
  envelope: TelemetryEnvelope,
  events: TelemetryEvent[],
  receivedAt = Date.now()
): number {
  const insertEvent = db.prepare(`
    INSERT INTO events (install_id, session_id, name, props, app_version, platform, arch, os_version, at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const touchInstall = db.prepare(`
    INSERT INTO installs (install_id, first_seen, last_seen, app_version, platform, arch, os_version)
    VALUES (@id, @now, @now, @version, @platform, @arch, @os)
    ON CONFLICT(install_id) DO UPDATE SET
      last_seen = @now,
      app_version = @version,
      platform = @platform,
      arch = @arch,
      os_version = @os
  `)

  const write = db.transaction((batch: TelemetryEvent[]) => {
    for (const event of batch) {
      const { name, ...props } = event as { name: string } & Record<string, unknown>
      const at = typeof props['at'] === 'number' ? (props['at'] as number) : receivedAt
      delete props['at']

      insertEvent.run(
        envelope.installId,
        envelope.sessionId,
        name,
        JSON.stringify(props),
        envelope.appVersion,
        envelope.platform,
        envelope.arch,
        envelope.osVersion,
        at,
        receivedAt
      )
    }

    touchInstall.run({
      id: envelope.installId,
      now: receivedAt,
      version: envelope.appVersion,
      platform: envelope.platform,
      arch: envelope.arch,
      os: envelope.osVersion
    })

    return batch.length
  })

  return write(events)
}

export interface Summary {
  installs: number
  installsActive7d: number
  installsActive30d: number
  newInstalls7d: number
  launches7d: number
  /** Median session length in minutes, over the last 7 days. */
  medianSessionMinutes: number
  claudeInstalledShare: number | null
  errors7d: number
  installsWithErrors7d: number
}

const DAY = 86_400_000

export function summary(db: Database.Database, now = Date.now()): Summary {
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...(args as [])) as { n: number }).n

  const installs = count('SELECT COUNT(*) AS n FROM installs')
  const installsActive7d = count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', now - 7 * DAY)
  const installsActive30d = count('SELECT COUNT(*) AS n FROM installs WHERE last_seen >= ?', now - 30 * DAY)
  const newInstalls7d = count('SELECT COUNT(*) AS n FROM installs WHERE first_seen >= ?', now - 7 * DAY)
  const launches7d = count(
    "SELECT COUNT(*) AS n FROM events WHERE name = 'app_launched' AND received_at >= ?",
    now - 7 * DAY
  )
  const errors7d = count("SELECT COUNT(*) AS n FROM events WHERE name = 'error' AND received_at >= ?", now - 7 * DAY)
  const installsWithErrors7d = count(
    "SELECT COUNT(DISTINCT install_id) AS n FROM events WHERE name = 'error' AND received_at >= ?",
    now - 7 * DAY
  )

  // Median rather than mean: one person who left it open over a weekend should not be
  // able to claim everybody uses it for nine hours.
  const sessions = db
    .prepare(
      "SELECT json_extract(props, '$.sessionSeconds') AS s FROM events WHERE name = 'app_closed' AND received_at >= ? ORDER BY s"
    )
    .all(now - 7 * DAY) as Array<{ s: number }>
  const medianSessionMinutes =
    sessions.length === 0 ? 0 : Math.round((sessions[Math.floor(sessions.length / 2)]?.s ?? 0) / 6) / 10

  const claude = db
    .prepare(
      `SELECT
         SUM(CASE WHEN json_extract(props, '$.claudeInstalled') IN (1, 'true') THEN 1 ELSE 0 END) AS yes,
         COUNT(*) AS total
       FROM events WHERE name = 'app_launched' AND received_at >= ?`
    )
    .get(now - 30 * DAY) as { yes: number | null; total: number }

  return {
    installs,
    installsActive7d,
    installsActive30d,
    newInstalls7d,
    launches7d,
    medianSessionMinutes,
    claudeInstalledShare: claude.total > 0 ? (claude.yes ?? 0) / claude.total : null,
    errors7d,
    installsWithErrors7d
  }
}

/**
 * Daily active installs, for the one chart that answers "is this growing".
 *
 * Bucketed by when the event happened rather than when it arrived. Batches are sent on a
 * timer and a machine that was offline for a week delivers the whole week at once, so
 * grouping on arrival draws a spike on the day someone reconnected and nothing on the
 * days they were actually working.
 *
 * The client clock is not trusted for anything else, so it is clamped: an event claiming
 * to be from the future, or from before the window, is bucketed by arrival instead. That
 * bounds what a wrong clock or a hand-edited payload can do to the chart.
 */
export function activeByDay(db: Database.Database, days = 30, now = Date.now()): Array<{ day: string; installs: number; launches: number }> {
  const since = now - days * DAY
  return db
    .prepare(
      `SELECT date(
                CASE WHEN at BETWEEN ? AND ? THEN at ELSE received_at END / 1000,
                'unixepoch'
              ) AS day,
              COUNT(DISTINCT install_id) AS installs,
              SUM(CASE WHEN name = 'app_launched' THEN 1 ELSE 0 END) AS launches
       FROM events
       WHERE received_at >= ? OR at >= ?
       GROUP BY day
       HAVING day >= date(? / 1000, 'unixepoch')
       ORDER BY day`
    )
    .all(since, now + DAY, since, since, since) as Array<{ day: string; installs: number; launches: number }>
}

/** Feature counts, and how many distinct installs used each, which is the honest number. */
export function featureUsage(db: Database.Database, days = 30, now = Date.now()): Array<{ feature: string; uses: number; installs: number }> {
  return db
    .prepare(
      `SELECT json_extract(props, '$.feature') AS feature,
              COUNT(*) AS uses,
              COUNT(DISTINCT install_id) AS installs
       FROM events
       WHERE name = 'feature_used' AND received_at >= ?
       GROUP BY feature
       ORDER BY installs DESC, uses DESC`
    )
    .all(now - days * DAY) as Array<{ feature: string; uses: number; installs: number }>
}

/** Whatever is breaking, grouped so one loud install cannot dominate the list. */
export function topErrors(db: Database.Database, days = 30, limit = 25, now = Date.now()): Array<{ errorName: string; message: string; kind: string; count: number; installs: number; lastSeen: number; stack: string | null }> {
  return db
    .prepare(
      `SELECT json_extract(props, '$.errorName') AS errorName,
              json_extract(props, '$.message')   AS message,
              json_extract(props, '$.kind')      AS kind,
              COUNT(*) AS count,
              COUNT(DISTINCT install_id) AS installs,
              MAX(received_at) AS lastSeen,
              MAX(json_extract(props, '$.stack')) AS stack
       FROM events
       WHERE name = 'error' AND received_at >= ?
       GROUP BY errorName, message, kind
       ORDER BY installs DESC, count DESC
       LIMIT ?`
    )
    .all(now - days * DAY, limit) as Array<{ errorName: string; message: string; kind: string; count: number; installs: number; lastSeen: number; stack: string | null }>
}

/** Simple breakdowns: version, platform, and how many installs each has. */
export function breakdown(db: Database.Database, column: 'app_version' | 'platform' | 'arch' | 'os_version'): Array<{ value: string; installs: number }> {
  return db
    .prepare(`SELECT ${column} AS value, COUNT(*) AS installs FROM installs GROUP BY value ORDER BY installs DESC`)
    .all() as Array<{ value: string; installs: number }>
}

/** Which preview tools agents actually reach for, which is worth knowing on its own. */
export function previewToolUsage(db: Database.Database, days = 30, now = Date.now()): Array<{ tool: string; uses: number; installs: number }> {
  return db
    .prepare(
      `SELECT json_extract(props, '$.tool') AS tool,
              COUNT(*) AS uses,
              COUNT(DISTINCT install_id) AS installs
       FROM events
       WHERE name = 'preview_tool_used' AND received_at >= ?
       GROUP BY tool
       ORDER BY uses DESC`
    )
    .all(now - days * DAY) as Array<{ tool: string; uses: number; installs: number }>
}

/**
 * Delete events older than the retention window.
 *
 * Retention is a feature, not an afterthought: data you no longer need is data you can
 * still leak. Installs are kept, because they are a random id and two timestamps, and
 * losing them would make "how many people" wrong forever.
 */
export function prune(db: Database.Database, retentionDays: number, now = Date.now()): number {
  const result = db.prepare('DELETE FROM events WHERE received_at < ?').run(now - retentionDays * DAY)
  return result.changes
}
