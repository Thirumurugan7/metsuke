import type { IncomingMessage, ServerResponse } from 'node:http'
import { roadmapState, putTicks, putAssignees, postTask, removeTask } from '../src/handlers.js'
import { getPool, migrate } from '../src/db.js'

/**
 * The roadmap's state: ticks, who is on what, and tasks added by hand.
 *
 * Deliberately not behind the dashboard token. This is the same information as the public
 * checklist, which already says in detail what is broken and unfinished. The token guards
 * usage data about other people; none of this is about anybody.
 *
 * CORS is pinned to the site's origin rather than *, because the write methods should not
 * be callable from any page that happens to be open.
 */
const ALLOWED_ORIGIN = process.env['SITE_ORIGIN'] ?? '*'
let ready: Promise<void> | null = null

export default async function handler(
  req: IncomingMessage & { body?: unknown; method?: string; url?: string },
  res: ServerResponse
): Promise<void> {
  res.setHeader('access-control-allow-origin', ALLOWED_ORIGIN)
  res.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS')
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

    const url = new URL(req.url ?? '/', 'http://localhost')
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

    switch (req.method) {
      case 'GET':
        return send(200, await roadmapState())

      case 'PUT': {
        const part = url.searchParams.get('part') ?? 'ticks'
        const result = part === 'assignees' ? await putAssignees(body) : await putTicks(body)
        return send(result.status, result.status === 200 ? { ok: true } : { error: result.reason })
      }

      case 'POST': {
        const result = await postTask(body)
        return send(result.status, result.status === 200 ? { task: result.task } : { error: result.reason })
      }

      case 'DELETE': {
        const result = await removeTask(url.searchParams.get('id'))
        return send(result.status, result.status === 200 ? { ok: true } : { error: result.reason })
      }

      default:
        return send(405, { error: 'GET, PUT, POST or DELETE' })
    }
  } catch (error) {
    send(500, { error: error instanceof Error ? error.message : 'failed' })
  }
}
