import { manifest, latestFor, directorySource, type Source } from './downloads.js'
import { githubSource } from './githubSource.js'

/**
 * The routes, shared by the Vercel function and the standalone server so that both
 * behave identically — the alternative is two implementations and one of them tested.
 *
 * Which backend is in use is decided by configuration alone:
 *   DOWNLOAD_DIR    a folder on this machine, for a server you own
 *   GITHUB_TOKEN    a release on GitHub, including a private repository
 */
export function source(): Source | null {
  const dir = process.env['DOWNLOAD_DIR']
  if (dir) return directorySource(dir)

  /*
   * GITHUB_REPO is accepted as well because it is the name anyone would guess sitting
   * next to GITHUB_TOKEN, and a setting that is silently ignored is worse than one that
   * is missing: it looks configured. The default is the repo this is released from, so
   * neither name has to be set for the normal case.
   */
  const repo = process.env['RELEASES_REPO'] ?? process.env['GITHUB_REPO'] ?? 'Thirumurugan7/metsuke'

  /*
   * The token is optional, because a public repo does not need one. It used to be the
   * switch that turned downloads on at all, which meant making the repo public — the one
   * change that removes every auth problem here — would instead have turned downloads
   * off, reported as "downloads are not configured". Anonymous reads are rate limited
   * per IP rather than per token, so a token is still worth setting if there is one.
   */
  return githubSource(repo, process.env['GITHUB_TOKEN'] ?? null)
}

export interface Reply {
  status: number
  /** Send a redirect. */
  redirect?: string
  json?: unknown
  body?: Buffer
  contentType?: string
  cacheControl?: string
}

const notConfigured: Reply = {
  status: 503,
  json: { error: 'downloads are not configured: set DOWNLOAD_DIR, or RELEASES_REPO for a public repo' }
}

/**
 * `pathname` is whatever followed /download, so:
 *   ''                    the manifest
 *   'latest/mac-arm64'    the stable per-platform link
 *   'Metsuke-0.1.0.dmg'   one specific file
 */
export async function handleDownload(pathname: string): Promise<Reply> {
  const src = source()
  if (!src) return notConfigured

  const rest = pathname.replace(/^\/+|\/+$/g, '')

  if (rest === '') {
    const m = await manifest(src)
    if (!m) return { status: 404, json: { error: 'no release published yet' } }
    return { status: 200, json: m, cacheControl: 'public, max-age=300' }
  }

  if (rest.startsWith('latest/')) {
    const platform = rest.slice('latest/'.length)
    const name = await latestFor(src, platform)
    if (!name) return { status: 404, json: { error: `nothing published for ${platform}` } }

    // A permanent redirect would be wrong: "latest" is the one URL whose meaning is
    // supposed to change, and a browser that cached it forever would never see a new
    // version again.
    return { status: 302, redirect: `../${encodeURIComponent(name)}`, cacheControl: 'no-store' }
  }

  const resolved = await src.resolve(decodeURIComponent(rest))
  if (!resolved) return { status: 404, json: { error: `no file named ${rest}` } }

  if ('redirect' in resolved) {
    // The signed URL expires, so this must not be cached.
    return { status: 302, redirect: resolved.redirect, cacheControl: 'no-store' }
  }

  return {
    status: 200,
    body: resolved.body,
    contentType: resolved.contentType,
    // An installer for a released version never changes, so it can be cached hard.
    cacheControl: rest.endsWith('.yml') ? 'public, max-age=300' : 'public, max-age=31536000, immutable'
  }
}
