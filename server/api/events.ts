import type { IncomingMessage, ServerResponse } from 'node:http'
import { acceptEnvelope, rateLimited } from '../src/handlers.js'
import { getPool, migrate } from '../src/db.js'

/**
 * Ingest, as a Vercel function.
 *
 * Unauthenticated on purpose: the clients are copies of a desktop app that have no
 * credential to offer and never will. What stands in for authentication is that nothing
 * here trusts the payload — every event is validated against the shared schema, the batch
 * is size-capped, and the body is capped by the platform.
 */

/** Run once per cold start, not per request: CREATE TABLE IF NOT EXISTS is still a round trip. */
let ready: Promise<void> | null = null
const ensureSchema = (): Promise<void> => (ready ??= migrate(getPool()))

export default async function handler(req: IncomingMessage & { body?: unknown; method?: string }, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (req.method !== 'POST') return send(405, { error: 'POST only' })

  // Behind a proxy this is the client; without one it is the proxy. Either way it is
  // hashed for a counter and never stored.
  const forwarded = req.headers['x-forwarded-for']
  const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown'
  if (rateLimited(address)) return send(429, { error: 'slow down' })

  try {
    await ensureSchema()
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const result = await acceptEnvelope(body)
    send(result.status, result.status === 200 ? { stored: result.stored } : { error: result.reason })
  } catch (error) {
    send(400, { error: error instanceof Error ? error.message : 'bad request' })
  }
}
