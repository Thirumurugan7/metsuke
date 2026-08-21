import type { IncomingMessage, ServerResponse } from 'node:http'
import { getTicks, putTicks } from '../src/handlers.js'
import { getPool, migrate } from '../src/db.js'

/**
 * Shared checklist ticks.
 *
 * Deliberately not behind the dashboard token: this is the same information as the public
 * roadmap page, which lists in detail what is broken and unfinished. The token guards
 * usage data about other people; a tick is a checkbox on a page anyone can read.
 *
 * The site is a different origin, so CORS has to be explicit. It is pinned to the site's
 * origin rather than *, because the write endpoint should not be callable from any page
 * that happens to be open.
 */
const ALLOWED_ORIGIN = process.env['SITE_ORIGIN'] ?? '*'
let ready: Promise<void> | null = null

export default async function handler(req: IncomingMessage & { body?: unknown; method?: string }, res: ServerResponse): Promise<void> {
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN)
  res.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('vary', 'origin')

  if (req.method === 'OPTIONS') return void res.writeHead(204).end()

  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  try {
    ready ??= migrate(getPool())
    await ready

    if (req.method === 'GET') return send(200, await getTicks())

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      const result = await putTicks(body)
      return send(result.status, result.status === 200 ? { ok: true } : { error: result.reason })
    }

    send(405, { error: 'GET or PUT' })
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : 'failed' })
  }
}
