import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, migrate, prune } from './db.js'
import { acceptEnvelope, authorised, overview, rateLimited, roadmapState, putTicks, putAssignees, postTask, removeTask, RETENTION_DAYS } from './handlers.js'

/**
 * The long-running version, for a VM.
 *
 * Vercel functions in api/ are the other front end and share every rule with this one via
 * handlers.ts. This file exists so the thing can also run on a box you own, which matters
 * for anyone who would rather not hand their users' data to a third party — and because
 * a process you can start locally is much easier to debug than a deployment.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env['PORT'] ?? 8787)

/** Bodies are batches of at most 50 small events; anything larger is not ours. */
const MAX_BODY_BYTES = 256 * 1024

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
        // Stop reading but leave the socket alive long enough to say why: destroying it
        // here means an oversized post gets no answer at all, which from the client's
        // side is indistinguishable from the server being down.
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

  try {
    if (req.method === 'POST' && url.pathname === '/v1/events') {
      const address = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown'
      if (rateLimited(address)) return json(res, 429, { error: 'slow down' })

      const result = await acceptEnvelope(JSON.parse(await readBody(req)))
      return json(res, result.status, result.status === 200 ? { stored: result.stored } : { error: result.reason })
    }

    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true })

    /*
     * The roadmap's own state: ticks, who is on what, and tasks added by hand.
     *
     * Deliberately not behind the dashboard token. This is the same information as the
     * public checklist, which already says in detail what is broken and unfinished. The
     * token guards usage data about other people; none of this is about anybody.
     */
    if (url.pathname === '/api/roadmap') {
      // The site is a different origin, so this has to be explicit — and it has to match
      // the function in api/roadmap.ts, or the two front ends behave differently and only
      // one of them gets tested.
      res.setHeader('access-control-allow-origin', process.env['SITE_ORIGIN'] ?? '*')
      res.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      res.setHeader('vary', 'origin')
      if (req.method === 'OPTIONS') return void res.writeHead(204).end()

      if (req.method === 'GET') return json(res, 200, await roadmapState())

      if (req.method === 'PUT') {
        const part = url.searchParams.get('part') ?? 'ticks'
        const body = JSON.parse(await readBody(req))
        const result = part === 'assignees' ? await putAssignees(body) : await putTicks(body)
        return json(res, result.status, result.status === 200 ? { ok: true } : { error: result.reason })
      }

      if (req.method === 'POST') {
        const result = await postTask(JSON.parse(await readBody(req)))
        return json(res, result.status, result.status === 200 ? { task: result.task } : { error: result.reason })
      }

      if (req.method === 'DELETE') {
        const result = await removeTask(url.searchParams.get('id'))
        return json(res, result.status, result.status === 200 ? { ok: true } : { error: result.reason })
      }
    }

    const needsAuth = url.pathname.startsWith('/api/overview') || url.pathname === '/' || url.pathname === '/index.html'
    if (needsAuth && !authorised(req.headers.authorization)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Metsuke telemetry"' })
      return res.end('Unauthorized')
    }

    if (req.method === 'GET' && url.pathname === '/api/overview') {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? 30)))
      return json(res, 200, await overview(days))
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const candidates = [path.join(here, '..', '..', 'public', 'index.html'), path.join(process.cwd(), 'public', 'index.html')]
      const file = candidates.find((c) => fs.existsSync(c))
      if (!file) return json(res, 500, { error: 'dashboard not found' })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(fs.readFileSync(file))
    }

    json(res, 404, { error: 'not found' })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400
    json(res, status, { error: error instanceof Error ? error.message : 'bad request' })
    req.destroy()
  }
})

if (process.env['NODE_ENV'] !== 'test') {
  if (!process.env['DASHBOARD_TOKEN']) {
    console.error('Refusing to start: set DASHBOARD_TOKEN, or the dashboard is open to anyone.')
    process.exit(1)
  }

  const db = getPool()
  await migrate(db)

  const pruneNow = async (): Promise<void> => {
    const removed = await prune(db, RETENTION_DAYS)
    if (removed > 0) console.log(`[telemetry] pruned ${removed} events older than ${RETENTION_DAYS} days`)
  }
  await pruneNow()
  setInterval(() => void pruneNow(), 24 * 60 * 60 * 1000).unref()

  server.listen(PORT, () => {
    console.log(`[telemetry] ingest on :${PORT}/v1/events, dashboard on :${PORT}/`)
    console.log(`[telemetry] postgres, retention ${RETENTION_DAYS} days`)
  })
}

export { server }
