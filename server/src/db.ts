import pg from 'pg'
import type { TelemetryEnvelope, TelemetryEvent } from '../../src/shared/telemetry.js'

/**
 * Storage for usage reporting: Neon Postgres.
 *
 * It was SQLite, which was the right call for one box with a disk. Postgres is the right
 * call for the shape this ended up in: the ingest endpoint and the dashboard run as
 * serverless functions, and a function has no disk to keep a file on. Nothing about the
 * data wanted a bigger database — this is a hosting decision, not a scale one.
 *
 * Connections go through Neon's pooler host, which is PgBouncer. That matters more than
 * it looks: a function opens a connection per invocation, and a few hundred cold starts
 * against a direct Postgres endpoint exhausts it.
 *
 * Two things are deliberately not stored, unchanged from before. There is no IP column:
 * the address is used to rate limit and then dropped. And there is no raw envelope blob,
 * because keeping the original "just in case" is how data nobody agreed to ends up on
 * disk anyway.
 */

export type Db = pg.Pool

let shared: pg.Pool | null = null

/**
 * The pool, made once per process.
 *
 * Serverless reuses a warm process for many requests, so building a pool per request
 * would leak connections until the pooler refused them. `max: 1` because a function
 * handles one request at a time and a bigger pool per instance is just more sockets
 * against the same ceiling.
 */
export function getPool(connectionString = process.env['DATABASE_URL']): pg.Pool {
  if (shared) return shared
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  shared = new pg.Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: true }
  })
  return shared
}

/** Create the tables. Safe to run on every boot; that is how migrations happen here. */
export async function migrate(db: Db, schema = 'public'): Promise<void> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}.events (
      id          BIGSERIAL PRIMARY KEY,
      install_id  TEXT   NOT NULL,
      session_id  TEXT   NOT NULL,
      name        TEXT   NOT NULL,
      props       JSONB  NOT NULL,
      app_version TEXT   NOT NULL,
      platform    TEXT   NOT NULL,
      arch        TEXT   NOT NULL,
      os_version  TEXT   NOT NULL,
      at          BIGINT NOT NULL,
      received_at BIGINT NOT NULL
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS events_received ON ${quoteIdent(schema)}.events (received_at)`)
  await db.query(`CREATE INDEX IF NOT EXISTS events_name ON ${quoteIdent(schema)}.events (name, received_at)`)
  await db.query(`CREATE INDEX IF NOT EXISTS events_install ON ${quoteIdent(schema)}.events (install_id, received_at)`)

  // One row per install, so "how many people" is not a scan of every event.
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}.installs (
      install_id  TEXT PRIMARY KEY,
      first_seen  BIGINT NOT NULL,
      last_seen   BIGINT NOT NULL,
      app_version TEXT NOT NULL,
      platform    TEXT NOT NULL,
      arch        TEXT NOT NULL,
      os_version  TEXT NOT NULL
    )
  `)

  // Roadmap ticks: one row, one JSON blob, shared by whoever has the link. Here rather
  // than in its own database because it is three fields and a second Neon project would
  // be a second thing to remember.
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}.roadmap_ticks (
      id         TEXT PRIMARY KEY,
      state      JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `)
}

/** Postgres identifier quoting. Schema names here are ours, but never interpolate raw. */
function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`)
  return `"${name}"`
}

/**
 * Every query goes through here so the schema can be swapped for tests.
 *
 * Tests run against a throwaway schema in the same database, which is what makes it
 * possible to test against real Postgres rather than a mock that agrees with whatever the
 * code does.
 */
export function tables(schema = process.env['DB_SCHEMA'] ?? 'public'): { events: string; installs: string; ticks: string } {
  const s = quoteIdent(schema)
  return { events: `${s}.events`, installs: `${s}.installs`, ticks: `${s}.roadmap_ticks` }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Write one envelope's worth of events. Returns how many were stored. */
export async function insertEnvelope(
  db: Db,
  envelope: TelemetryEnvelope,
  events: TelemetryEvent[],
  receivedAt = Date.now(),
  schema?: string
): Promise<number> {
  const t = tables(schema)
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    for (const event of events) {
      const { name, ...props } = event as { name: string } & Record<string, unknown>
      const at = typeof props['at'] === 'number' ? (props['at'] as number) : receivedAt
      delete props['at']

      await client.query(
        `INSERT INTO ${t.events} (install_id, session_id, name, props, app_version, platform, arch, os_version, at, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [envelope.installId, envelope.sessionId, name, JSON.stringify(props), envelope.appVersion, envelope.platform, envelope.arch, envelope.osVersion, at, receivedAt]
      )
    }

    await client.query(
      `INSERT INTO ${t.installs} (install_id, first_seen, last_seen, app_version, platform, arch, os_version)
       VALUES ($1, $2, $2, $3, $4, $5, $6)
       ON CONFLICT (install_id) DO UPDATE SET
         last_seen = EXCLUDED.last_seen,
         app_version = EXCLUDED.app_version,
         platform = EXCLUDED.platform,
         arch = EXCLUDED.arch,
         os_version = EXCLUDED.os_version`,
      [envelope.installId, receivedAt, envelope.appVersion, envelope.platform, envelope.arch, envelope.osVersion]
    )

    await client.query('COMMIT')
    return events.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

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
const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value))

export async function summary(db: Db, now = Date.now(), schema?: string): Promise<Summary> {
  const t = tables(schema)
  const week = now - 7 * DAY
  const month = now - 30 * DAY

  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM ${t.installs})                                              AS installs,
       (SELECT COUNT(*) FROM ${t.installs} WHERE last_seen >= $1)                        AS active7,
       (SELECT COUNT(*) FROM ${t.installs} WHERE last_seen >= $2)                        AS active30,
       (SELECT COUNT(*) FROM ${t.installs} WHERE first_seen >= $1)                       AS new7,
       (SELECT COUNT(*) FROM ${t.events} WHERE name = 'app_launched' AND received_at >= $1)      AS launches7,
       (SELECT COUNT(*) FROM ${t.events} WHERE name = 'error' AND received_at >= $1)             AS errors7,
       (SELECT COUNT(DISTINCT install_id) FROM ${t.events} WHERE name = 'error' AND received_at >= $1) AS installs_errors7,
       -- Median, not mean: one person who left it open over a weekend should not be able
       -- to claim everybody uses it for nine hours.
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'sessionSeconds')::numeric)
          FROM ${t.events} WHERE name = 'app_closed' AND received_at >= $1)              AS median_seconds,
       (SELECT COUNT(*) FROM ${t.events}
          WHERE name = 'app_launched' AND received_at >= $2 AND props->>'claudeInstalled' = 'true') AS claude_yes,
       (SELECT COUNT(*) FROM ${t.events} WHERE name = 'app_launched' AND received_at >= $2)        AS claude_total`,
    [week, month]
  )

  const r = rows[0]
  const claudeTotal = num(r.claude_total)

  return {
    installs: num(r.installs),
    installsActive7d: num(r.active7),
    installsActive30d: num(r.active30),
    newInstalls7d: num(r.new7),
    launches7d: num(r.launches7),
    medianSessionMinutes: r.median_seconds === null ? 0 : Math.round(num(r.median_seconds) / 6) / 10,
    claudeInstalledShare: claudeTotal > 0 ? num(r.claude_yes) / claudeTotal : null,
    errors7d: num(r.errors7),
    installsWithErrors7d: num(r.installs_errors7)
  }
}

/**
 * Daily active installs, bucketed by when the event happened rather than when it arrived.
 *
 * Batches are sent on a timer and a machine that was offline for a week delivers the
 * whole week at once, so grouping on arrival draws a spike on the day someone reconnected
 * and nothing on the days they were working. The client clock is clamped: an event
 * claiming to be from the future, or from before the window, is bucketed by arrival, which
 * bounds what a wrong clock can do to the chart.
 */
export async function activeByDay(db: Db, days = 30, now = Date.now(), schema?: string): Promise<Array<{ day: string; installs: number; launches: number }>> {
  const t = tables(schema)
  const since = now - days * DAY

  const { rows } = await db.query(
    `SELECT to_char(to_timestamp(
              (CASE WHEN at BETWEEN $1 AND $2 THEN at ELSE received_at END) / 1000.0
            ) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT install_id) AS installs,
            COUNT(*) FILTER (WHERE name = 'app_launched') AS launches
     FROM ${t.events}
     WHERE received_at >= $1 OR at >= $1
     GROUP BY day
     HAVING to_char(to_timestamp(
              (CASE WHEN at BETWEEN $1 AND $2 THEN at ELSE received_at END) / 1000.0
            ) AT TIME ZONE 'UTC', 'YYYY-MM-DD') >= to_char(to_timestamp($1 / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')
     ORDER BY day`,
    [since, now + DAY]
  )

  return rows.map((r) => ({ day: r.day as string, installs: num(r.installs), launches: num(r.launches) }))
}

/** Feature counts, and how many distinct installs used each, which is the honest number. */
export async function featureUsage(db: Db, days = 30, now = Date.now(), schema?: string): Promise<Array<{ feature: string; uses: number; installs: number }>> {
  const t = tables(schema)
  const { rows } = await db.query(
    `SELECT props->>'feature' AS feature, COUNT(*) AS uses, COUNT(DISTINCT install_id) AS installs
     FROM ${t.events}
     WHERE name = 'feature_used' AND received_at >= $1
     GROUP BY feature
     ORDER BY installs DESC, uses DESC`,
    [now - days * DAY]
  )
  return rows.map((r) => ({ feature: r.feature as string, uses: num(r.uses), installs: num(r.installs) }))
}

/** Which preview tools agents actually reach for, which is worth knowing on its own. */
export async function previewToolUsage(db: Db, days = 30, now = Date.now(), schema?: string): Promise<Array<{ tool: string; uses: number; installs: number }>> {
  const t = tables(schema)
  const { rows } = await db.query(
    `SELECT props->>'tool' AS tool, COUNT(*) AS uses, COUNT(DISTINCT install_id) AS installs
     FROM ${t.events}
     WHERE name = 'preview_tool_used' AND received_at >= $1
     GROUP BY tool
     ORDER BY uses DESC`,
    [now - days * DAY]
  )
  return rows.map((r) => ({ tool: r.tool as string, uses: num(r.uses), installs: num(r.installs) }))
}

/** Whatever is breaking, grouped so one loud install cannot dominate the list. */
export async function topErrors(db: Db, days = 30, limit = 25, now = Date.now(), schema?: string): Promise<Array<{ errorName: string; message: string; kind: string; count: number; installs: number; lastSeen: number; stack: string | null }>> {
  const t = tables(schema)
  const { rows } = await db.query(
    `SELECT props->>'errorName' AS "errorName",
            props->>'message'   AS message,
            props->>'kind'      AS kind,
            COUNT(*) AS count,
            COUNT(DISTINCT install_id) AS installs,
            MAX(received_at) AS "lastSeen",
            MAX(props->>'stack') AS stack
     FROM ${t.events}
     WHERE name = 'error' AND received_at >= $1
     GROUP BY 1, 2, 3
     ORDER BY installs DESC, count DESC
     LIMIT $2`,
    [now - days * DAY, limit]
  )
  return rows.map((r) => ({
    errorName: r.errorName as string,
    message: r.message as string,
    kind: r.kind as string,
    count: num(r.count),
    installs: num(r.installs),
    lastSeen: num(r.lastSeen),
    stack: (r.stack as string | null) ?? null
  }))
}

/** Simple breakdowns: version, platform, and how many installs each has. */
export async function breakdown(db: Db, column: 'app_version' | 'platform' | 'arch' | 'os_version', schema?: string): Promise<Array<{ value: string; installs: number }>> {
  const t = tables(schema)
  // Whitelisted by the parameter type, and checked again here: this one is interpolated.
  if (!['app_version', 'platform', 'arch', 'os_version'].includes(column)) throw new Error('bad column')

  const { rows } = await db.query(
    `SELECT ${column} AS value, COUNT(*) AS installs FROM ${t.installs} GROUP BY value ORDER BY installs DESC`
  )
  return rows.map((r) => ({ value: r.value as string, installs: num(r.installs) }))
}

/**
 * Delete events older than the retention window.
 *
 * Retention is a feature, not an afterthought: data you no longer need is data you can
 * still leak. Installs are kept, being a random id and two timestamps, and losing them
 * would make "how many people" wrong forever.
 */
export async function prune(db: Db, retentionDays: number, now = Date.now(), schema?: string): Promise<number> {
  const t = tables(schema)
  const result = await db.query(`DELETE FROM ${t.events} WHERE received_at < $1`, [now - retentionDays * DAY])
  return result.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Roadmap ticks
// ---------------------------------------------------------------------------

/** Read the shared tick state. Empty object when nobody has ticked anything yet. */
export async function readTicks(db: Db, id = 'default', schema?: string): Promise<{ state: Record<string, boolean>; updatedAt: number }> {
  const t = tables(schema)
  const { rows } = await db.query(`SELECT state, updated_at FROM ${t.ticks} WHERE id = $1`, [id])
  if (rows.length === 0) return { state: {}, updatedAt: 0 }
  return { state: rows[0].state as Record<string, boolean>, updatedAt: num(rows[0].updated_at) }
}

/** Replace the shared tick state. Last write wins, which is right for one person's list. */
export async function writeTicks(db: Db, state: Record<string, boolean>, id = 'default', now = Date.now(), schema?: string): Promise<void> {
  const t = tables(schema)
  await db.query(
    `INSERT INTO ${t.ticks} (id, state, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
    [id, JSON.stringify(state), now]
  )
}
