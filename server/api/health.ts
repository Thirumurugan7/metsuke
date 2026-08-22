import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Liveness, for whatever is watching.
 *
 * Deliberately touches nothing: no database, no GitHub. A health check that depends on
 * everything else tells you the whole system is down when one part of it is, which is
 * the opposite of what it is for.
 */
export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: true, at: new Date().toISOString() }))
}
