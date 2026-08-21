import type { IncomingMessage, ServerResponse } from 'node:http'
import { authorised, overview } from '../src/handlers.js'
import { getPool, migrate } from '../src/db.js'

/** The dashboard's data. Behind DASHBOARD_TOKEN, because it is everything at once. */
let ready: Promise<void> | null = null

export default async function handler(req: IncomingMessage & { method?: string; url?: string }, res: ServerResponse): Promise<void> {
  if (!authorised(req.headers.authorization)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Metsuke telemetry"' })
    return void res.end('Unauthorized')
  }

  ready ??= migrate(getPool())
  await ready

  const url = new URL(req.url ?? '/', 'http://localhost')
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') ?? 30)))

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(await overview(days)))
}
