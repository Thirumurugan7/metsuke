import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Public downloads from a private repository.
 *
 * The code repo is private, and a private repo's release assets need an authenticated
 * request — which a person clicking a download button obviously does not have. So this
 * makes the request instead, with a token that never leaves the server, and hands back
 * the signed URL GitHub replies with.
 *
 * The bytes do not pass through here. Asking GitHub for an asset with
 * `Accept: application/octet-stream` returns a 302 to a signed object URL, and this
 * function forwards that redirect: a hundred megabytes goes browser-to-GitHub, not
 * through a serverless function with a bandwidth bill and a timeout.
 *
 * That also makes it the update feed. electron-updater's generic provider fetches
 * `<base>/latest-mac.yml` and then the file beside it, which is exactly the shape of
 * `/download/<name>` below.
 *
 * The token is read-only on one repository's contents. It cannot push, and it cannot see
 * anything else you own.
 */

const REPO = process.env['RELEASES_REPO'] ?? 'Thirumurugan7/metsuke'
const TOKEN = process.env['GITHUB_TOKEN'] ?? ''

/** Releases change on a tag, not on a request. Worth not asking GitHub every time. */
const CACHE_MS = 5 * 60 * 1000
let cached: { at: number; release: Release } | null = null

/** What went wrong, kept apart because these send you looking in different places. */
class GithubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

interface Release {
  tag_name: string
  name: string
  published_at: string
  assets: Array<{ id: number; name: string; size: number; content_type: string }>
}

async function latestRelease(): Promise<Release | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.release

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'user-agent': 'metsuke-downloads'
    }
  })

  /*
   * A 404 here means either no release or no access, because that is what GitHub returns
   * for a private repo you cannot see — it will not confirm that a repo exists. The two
   * send you looking in completely different places, so they are reported apart: a rate
   * limit and a rejected token say so, and only a genuine empty-releases answer is
   * "no release yet".
   */
  if (response.status === 401 || response.status === 403) {
    throw new GithubError(
      response.status,
      response.headers.get('x-ratelimit-remaining') === '0'
        ? 'github rate limit reached'
        : 'github rejected the token: check GITHUB_TOKEN can read this repository\'s contents'
    )
  }
  if (response.status === 404) return null
  if (!response.ok) throw new GithubError(response.status, `github said ${response.status}`)

  const release = (await response.json()) as Release
  cached = { at: Date.now(), release }
  return release
}

export default async function handler(
  req: IncomingMessage & { method?: string; url?: string },
  res: ServerResponse
): Promise<void> {
  // Anyone may download; that is the point. Only GET, because nothing here writes.
  res.setHeader('access-control-allow-origin', '*')
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  if (req.method !== 'GET') return void res.writeHead(405).end('GET only')

  if (!TOKEN) {
    res.writeHead(503, { 'content-type': 'application/json' })
    return void res.end(JSON.stringify({ error: 'downloads are not configured: GITHUB_TOKEN is unset' }))
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const file = url.searchParams.get('file') ?? ''

  try {
    const release = await latestRelease()
    if (!release) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return void res.end(
        JSON.stringify({ error: `no release yet, or ${REPO} is not visible to this token` })
      )
    }

    // No file named: describe the release, which is what the download page asks for.
    if (!file) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' })
      return void res.end(
        JSON.stringify({
          version: release.tag_name.replace(/^v/, ''),
          publishedAt: release.published_at,
          assets: release.assets.map((a) => ({ name: a.name, size: a.size, url: `/download/${encodeURIComponent(a.name)}` }))
        })
      )
    }

    const asset = release.assets.find((a) => a.name === file)
    if (!asset) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify({ error: `no asset named ${file}` }))
    }

    /*
     * `redirect: 'manual'` is the whole trick. Following the redirect here would stream
     * the file through this function; not following it means we can hand the caller the
     * signed URL and get out of the way.
     */
    const assetResponse = await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`, {
      headers: {
        accept: 'application/octet-stream',
        authorization: `Bearer ${TOKEN}`,
        'user-agent': 'metsuke-downloads'
      },
      redirect: 'manual'
    })

    const location = assetResponse.headers.get('location')
    if (location) {
      // The signed URL is short-lived, so this redirect must not be cached.
      res.writeHead(302, { location, 'cache-control': 'no-store' })
      return void res.end()
    }

    // Small files can come back inline rather than as a redirect. The update feeds are
    // a few hundred bytes and arrive this way.
    if (assetResponse.ok) {
      const body = Buffer.from(await assetResponse.arrayBuffer())
      res.writeHead(200, {
        'content-type': file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'public, max-age=300'
      })
      return void res.end(body)
    }

    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `github said ${assetResponse.status}` }))
  } catch (error) {
    const status = error instanceof GithubError ? 502 : 502
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'download failed' }))
  }
}
