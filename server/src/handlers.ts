import { createHash, timingSafeEqual } from 'node:crypto'
import {
  isValidEvent,
  TELEMETRY_SCHEMA_VERSION,
  type TelemetryEnvelope,
  type TelemetryEvent
} from '../../src/shared/telemetry.js'
import {
  getPool,
  insertEnvelope,
  readBlob,
  writeBlob,
  listTasks,
  addTask,
  deleteTask,
  type Assignee,
  type CustomTask,
  summary,
  activeByDay,
  featureUsage,
  topErrors,
  breakdown,
  previewToolUsage,
  readTicks,
  writeTicks,
  type Db
} from './db.js'

/**
 * What the endpoints do, with no HTTP framework anywhere near them.
 *
 * There are two front ends — a long-running Node server for a VM, and Vercel functions —
 * and neither should own the behaviour. Keeping the rules here means the ingest boundary
 * is tested once and both entry points inherit it, rather than the tested path being the
 * one nobody deploys.
 */

export const RETENTION_DAYS = Number(process.env['RETENTION_DAYS'] ?? 180)
const RATE_LIMIT_PER_MINUTE = Number(process.env['RATE_LIMIT_PER_MINUTE'] ?? 60)

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Addresses are hashed, counted, and never written down.
 *
 * In a serverless deployment this is per warm instance rather than global, which makes it
 * a speed bump instead of a wall. That is the honest trade: a real limiter needs shared
 * state, and adding Redis to stop somebody spamming a counter of panel clicks would cost
 * more than the thing it protects. The size caps below are the real defence.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(address: string, now = Date.now()): boolean {
  const key = createHash('sha256').update(address).digest('hex').slice(0, 16)
  const bucket = buckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    // Cheap sweep, so a long-lived process does not accumulate a bucket per address seen.
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k)
    return false
  }

  bucket.count += 1
  return bucket.count > RATE_LIMIT_PER_MINUTE
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface Accepted {
  status: number
  stored: number
  reason?: string
}

/**
 * Accept an envelope, or say why not.
 *
 * Every event is checked against the same schema the app validates with, imported from
 * the app's source rather than copied. That is the point of the arrangement: a client
 * that has been edited, or a future version with a bug in it, cannot store a shape nobody
 * agreed to. Invalid events are dropped individually, so one bad event does not discard a
 * batch of good ones.
 */
export async function acceptEnvelope(body: unknown, now = Date.now(), db: Db = getPool()): Promise<Accepted> {
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

  const stored = await insertEnvelope(db, envelope as TelemetryEnvelope, valid, now)
  return { status: 200, stored }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Constant-time, so the token cannot be guessed a character at a time. */
export function tokenMatches(given: string, expected = process.env['DASHBOARD_TOKEN'] ?? ''): boolean {
  if (!expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Accepts either a bearer token or HTTP basic, where the password is the token. */
export function authorised(header: string | undefined, expected?: string): boolean {
  if (!header) return false
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    return tokenMatches(decoded.split(':').slice(1).join(':'), expected)
  }
  if (header.startsWith('Bearer ')) return tokenMatches(header.slice(7), expected)
  return false
}

export async function overview(days = 30, db: Db = getPool()): Promise<Record<string, unknown>> {
  // One round trip each, in parallel: sequentially this is nine hops to another region.
  const [s, byDay, features, tools, errors, versions, platforms, osVersions] = await Promise.all([
    summary(db),
    activeByDay(db, days),
    featureUsage(db, days),
    previewToolUsage(db, days),
    topErrors(db, days),
    breakdown(db, 'app_version'),
    breakdown(db, 'platform'),
    breakdown(db, 'os_version')
  ])

  return {
    summary: s,
    activeByDay: byDay,
    features,
    previewTools: tools,
    errors,
    versions,
    platforms,
    osVersions,
    retentionDays: RETENTION_DAYS,
    days
  }
}

// ---------------------------------------------------------------------------
// Roadmap: ticks, assignees, and tasks added by hand
// ---------------------------------------------------------------------------

/** The two people who work on this. Anything else is not a person, it is a typo. */
export const ASSIGNEES = ['thiru', 'prashant'] as const

/** Ticks are a flat map of task id to boolean, and nothing else is accepted. */
export function validTickState(value: unknown): value is Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  // A bound on both count and key length: this is a checklist, not a key-value store
  // somebody found on the internet.
  if (entries.length > 200) return false
  return entries.every(([key, v]) => typeof key === 'string' && key.length <= 64 && typeof v === 'boolean')
}

/** Assignees are the same shape, but the values are a closed set of two names. */
export function validAssigneeState(value: unknown): value is Record<string, Assignee> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 200) return false
  return entries.every(
    ([key, v]) =>
      typeof key === 'string' && key.length <= 64 && (v === null || (typeof v === 'string' && (ASSIGNEES as readonly string[]).includes(v)))
  )
}

const MAX_TITLE = 120
const MAX_DETAIL = 2_000

/** A task somebody typed in. Bounded, because this endpoint takes free text. */
export function validTask(value: unknown): value is { title: string; detail?: string; group?: string; assignee?: Assignee; id?: string } {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>

  if (typeof t['title'] !== 'string' || t['title'].trim().length === 0 || t['title'].length > MAX_TITLE) return false
  if (t['detail'] !== undefined && (typeof t['detail'] !== 'string' || t['detail'].length > MAX_DETAIL)) return false
  if (t['group'] !== undefined && (typeof t['group'] !== 'string' || t['group'].length > 40)) return false
  if (t['id'] !== undefined && (typeof t['id'] !== 'string' || !/^[a-z0-9-]{1,64}$/.test(t['id']))) return false
  if (t['assignee'] !== undefined && t['assignee'] !== null && !(ASSIGNEES as readonly string[]).includes(t['assignee'] as string)) return false

  return true
}

/** Everything the roadmap page needs that is not in the committed file, in one trip. */
export async function roadmapState(db: Db = getPool()): Promise<{
  ticks: Record<string, boolean>
  assignees: Record<string, Assignee>
  tasks: CustomTask[]
}> {
  const [ticks, assignees, tasks] = await Promise.all([
    readBlob<boolean>(db, 'default'),
    readBlob<Assignee>(db, 'assignees'),
    listTasks(db)
  ])

  return { ticks: ticks.state, assignees: assignees.state, tasks }
}

export async function putTicks(body: unknown, now = Date.now(), db: Db = getPool()): Promise<Accepted> {
  const state = (body as { state?: unknown })?.state
  if (!validTickState(state)) return { status: 400, stored: 0, reason: 'bad state' }

  await writeBlob<boolean>(db, 'default', state, now)
  return { status: 200, stored: Object.keys(state).length }
}

export async function putAssignees(body: unknown, now = Date.now(), db: Db = getPool()): Promise<Accepted> {
  const state = (body as { state?: unknown })?.state
  if (!validAssigneeState(state)) return { status: 400, stored: 0, reason: 'bad state' }

  await writeBlob<Assignee>(db, 'assignees', state, now)
  return { status: 200, stored: Object.keys(state).length }
}

/** Slug from the title, with a short suffix so two "Fix the thing" tasks can coexist. */
export function taskId(title: string, now = Date.now()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${slug || 'task'}-${now.toString(36).slice(-4)}`
}

export async function postTask(body: unknown, now = Date.now(), db: Db = getPool()): Promise<Accepted & { task?: CustomTask }> {
  if (!validTask(body)) return { status: 400, stored: 0, reason: 'bad task' }
  const input = body as { title: string; detail?: string; group?: string; assignee?: Assignee; id?: string }

  const task: CustomTask = {
    id: input.id ?? taskId(input.title, now),
    title: input.title.trim(),
    detail: input.detail?.trim() ?? '',
    group: input.group ?? 'blocking',
    assignee: input.assignee ?? null,
    createdAt: now
  }

  await addTask(db, task, now)
  return { status: 200, stored: 1, task }
}

export async function removeTask(id: unknown, db: Db = getPool()): Promise<Accepted> {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) return { status: 400, stored: 0, reason: 'bad id' }

  const removed = await deleteTask(db, id)
  // A delete that removed nothing is not an error: the row may already be gone, and the
  // caller wanted it gone either way.
  return { status: removed ? 200 : 404, stored: removed ? 1 : 0, reason: removed ? undefined : 'no such task' }
}
