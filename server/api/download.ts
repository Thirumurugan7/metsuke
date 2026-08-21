import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleDownload } from '../src/downloadRoutes.js'

/**
 * Downloads, as a Vercel function.
 *
 * Everything it does lives in downloadRoutes.ts, shared with the standalone server, so
 * moving the files to a machine you own changes an environment variable rather than a URL
 * anybody has bookmarked.
 */
export default async function handler(
  req: IncomingMessage & { method?: string; url?: string },
  res: ServerResponse
): Promise<void> {
  res.setHeader('access-control-allow-origin', '*')
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end('GET only')

  const url = new URL(req.url ?? '/', 'http://localhost')

  try {
    const reply = await handleDownload(url.searchParams.get('path') ?? '')

    const headers: Record<string, string> = {}
    if (reply.cacheControl) headers['cache-control'] = reply.cacheControl

    if (reply.redirect) {
      res.writeHead(reply.status, { ...headers, location: reply.redirect })
      return void res.end()
    }

    if (reply.body) {
      res.writeHead(reply.status, { ...headers, 'content-type': reply.contentType ?? 'application/octet-stream', 'content-length': reply.body.length })
      return void res.end(reply.body)
    }

    res.writeHead(reply.status, { ...headers, 'content-type': 'application/json' })
    res.end(JSON.stringify(reply.json))
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'download failed' }))
  }
}
