import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual, createHash } from 'node:crypto'
import {
  isValidEvent,
  TELEMETRY_SCHEMA_VERSION,
  type TelemetryEnvelope,
  type TelemetryEvent
} from '../../src/shared/telemetry.js'
import {
  openDatabase,
  insertEnvelope,
  summary,
  activeByDay,
  featureUsage,
  topErrors,
  breakdown,
  previewToolUsage,
  prune
} from './db.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env['PORT'] ?? 8787)
const DB_FILE = process.env['TELEMETRY_DB'] ?? path.join(process.cwd(), 'telemetry.db')
/** Without this the dashboard refuses to start rather than serving your data to anyone. */
const DASHBOARD_TOKEN = process.env['DASHBOARD_TOKEN'] ?? ''
const RETENTION_DAYS = Number(process.env['RETENTION_DAYS'] ?? 180)

/** Bodies are batches of at most 50 small events; anything larger is not ours. */
const MAX_BODY_BYTES = 256 * 1024
/**
 * Per-address ceiling. Generous for a real client, which posts a batch a minute at
 * most, and useless for a flood. Configurable because behind a proxy that does not set
 * x-forwarded-for every install shares one address, and the default would then throttle
 * real traffic.
 */
const RATE_LIMIT_PER_MINUTE = Number(process.env['RATE_LIMIT_PER_MINUTE'] ?? 60)

const db = openDatabase(DB_FILE)

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Addresses are hashed, counted, and never written down.
 *
 * The ceiling has to be per-something, and the only thing an unauthenticated client
 * offers is its address. Hashing it means the process holds a fingerprint for a minute
 * rather than an IP, and nothing reaches the database either way.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(address: string, now = Date.now()): boolean {
  const key = createHash('sha256').update(address).digest('hex').slice(0, 16)
  const bucket = buckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    return false
  }

  bucket.count += 1
  return bucket.count > RATE_LIMIT_PER_MINUTE
}

// Buckets are the only state that grows on its own, so it is swept.
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (now > bucket.resetAt) buckets.delete(key)
}, 60_000).unref()

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Accept an envelope, or say why not.
 *
 * Every event is checked against the same schema the app validates with, imported from
 * the app's source rather than copied. That is the point of the arrangement: a client
 * that has been edited, or a future version with a bug in it, cannot store a shape
 * nobody agreed to. Invalid events are dropped individually, so one bad event does not
 * discard a batch of good ones.
 */
export function acceptEnvelope(body: unknown, now = Date.now()): { status: number; stored: number; reason?: string } {
  if (!body || typeof body !== 'object') return { status: 400, stored: 0, reason: 'not an object' }
  const envelope = body as Partial<TelemetryEnvelope>

  if (envelope.schema !== TELEMETRY_SCHEMA_VERSION) {
    // A newer client than the server is a deploy problem, not a client problem, and
    // rejecting it makes that visible instead of storing half-understood rows.
    return { status: 400, stored: 0, reason: `unsupported schema ${String(envelope.schema)}` }
  }

  const strings: Array<keyof TelemetryEnvelope> = ['installId', 'sessionId', 'appVersion', 'platform', 'arch', 'osVersion']
  for (const key of strings) {
    const value = envelope[key]
    if (typeof value !== 'string' || value.length === 0 || value.length > 100) {
      return { status: 400, stored: 0, reason: `bad ${String(key)}` }
    }
  }

  if (!Array.isArray(envelope.events) || envelope.events.length === 0 || envelope.events.length > 100) {
    return { status: 400, stored: 0, reason: 'bad events' }
  }

  const valid = envelope.events.filter((event) => isValidEvent(event)) as TelemetryEvent[]
  if (valid.length === 0) return { status: 400, stored: 0, reason: 'no valid events' }

  const stored = insertEnvelope(db, envelope as TelemetryEnvelope, valid, now)
  return { status: 200, stored }
}

// ---------------------------------------------------------------------------
// Dashboard auth
// ---------------------------------------------------------------------------

/** Constant-time, so the token cannot be guessed a character at a time. */
function tokenMatches(given: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(DASHBOARD_TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function authorised(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? ''
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    return tokenMatches(decoded.split(':').slice(1).join(':'))
  }
  if (header.startsWith('Bearer ')) return tokenMatches(header.slice(7))
  return false
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        // Stop reading but leave the socket alive long enough to say why. Destroying it
        // here meant an oversized post got no answer at all, which is indistinguishable
        // from the server being down.
        req.pause()
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // -- ingest ---------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/v1/events') {
    const address = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown'
    if (rateLimited(address)) return json(res, 429, { error: 'slow down' })

    try {
      const parsed = JSON.parse(await readBody(req)) as unknown
      const result = acceptEnvelope(parsed)
      return json(res, result.status, result.status === 200 ? { stored: result.stored } : { error: result.reason })
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400
      json(res, status, { error: error instanceof Error ? error.message : 'bad request' })
      // Whatever is still arriving is not wanted now that it has been answered.
      req.destroy()
      return
    }
  }

  // Liveness, for whatever runs this.
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })

  // -- dashboard ------------------------------------------------------------
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? 30)))

  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname === '/index.html') {
    if (!authorised(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Metsuke telemetry"' })
      return res.end('Unauthorized')
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/overview') {
    return json(res, 200, {
      summary: summary(db),
      activeByDay: activeByDay(db, days),
      features: featureUsage(db, days),
      previewTools: previewToolUsage(db, days),
      errors: topErrors(db, days),
      versions: breakdown(db, 'app_version'),
      platforms: breakdown(db, 'platform'),
      osVersions: breakdown(db, 'os_version'),
      retentionDays: RETENTION_DAYS,
      days
    })
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.join(here, '..', '..', 'public', 'index.html')
    const html = fs.readFileSync(fs.existsSync(file) ? file : path.join(process.cwd(), 'public', 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(html)
  }

  json(res, 404, { error: 'not found' })
})

if (process.env['NODE_ENV'] !== 'test') {
  if (!DASHBOARD_TOKEN) {
    console.error('Refusing to start: set DASHBOARD_TOKEN, or the dashboard is open to anyone.')
    process.exit(1)
  }

  // Retention runs on a timer rather than a cron, so there is one thing to deploy.
  const pruneNow = (): void => {
    const removed = prune(db, RETENTION_DAYS)
    if (removed > 0) console.log(`[telemetry] pruned ${removed} events older than ${RETENTION_DAYS} days`)
  }
  pruneNow()
  setInterval(pruneNow, 24 * 60 * 60 * 1000).unref()

  server.listen(PORT, () => {
    console.log(`[telemetry] ingest on :${PORT}/v1/events, dashboard on :${PORT}/`)
    console.log(`[telemetry] database ${DB_FILE}, retention ${RETENTION_DAYS} days`)
  })
}

export { server, db }
