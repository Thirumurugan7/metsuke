import type { Source } from './downloads.js'

/**
 * A GitHub release as a download source, including a private one.
 *
 * The token stays here. Asking for an asset with `Accept: application/octet-stream`
 * returns a 302 to a signed object URL, which is forwarded rather than followed, so a
 * hundred megabytes travels browser-to-GitHub instead of through this process.
 */
interface Release {
  tag_name: string
  published_at: string
  assets: Array<{ id: number; name: string; size: number }>
}

class GithubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const CACHE_MS = 5 * 60 * 1000

export function githubSource(repo: string, token: string): Source {
  let cached: { at: number; release: Release } | null = null

  const api = async (url: string, accept: string, redirect: RequestRedirect = 'follow'): Promise<Response> =>
    fetch(url, {
      headers: { accept, authorization: `Bearer ${token}`, 'user-agent': 'metsuke-downloads' },
      redirect
    })

  const latest = async (): Promise<Release | null> => {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.release

    const response = await api(`https://api.github.com/repos/${repo}/releases/latest`, 'application/vnd.github+json')

    /*
     * GitHub answers 404 both for "no release" and for "a private repo you cannot see" —
     * it will not confirm that a repo exists. Those send you looking in different places,
     * so a rejected token and a rate limit are reported as themselves.
     */
    if (response.status === 401 || response.status === 403) {
      throw new GithubError(
        response.status,
        response.headers.get('x-ratelimit-remaining') === '0'
          ? 'github rate limit reached'
          : "github rejected the token: check it can read this repository's contents"
      )
    }
    /*
     * A 404 is ambiguous, and the ambiguity is expensive: "no release yet" is the
     * normal state before the first build, while "wrong repo name" looks exactly the
     * same and sends you auditing a token that was never the problem. It cost a round
     * of debugging here. So ask whether the repo itself is visible, and let the two
     * answers say different things.
     */
    if (response.status === 404) {
      const repoCheck = await api(`https://api.github.com/repos/${repo}`, 'application/vnd.github+json')
      if (repoCheck.status === 404) {
        throw new GithubError(404, `cannot see ${repo}: the token cannot read this repo (Contents: Read), or RELEASES_REPO is wrong`)
      }
      return null
    }
    if (!response.ok) throw new GithubError(response.status, `github said ${response.status}`)

    const release = (await response.json()) as Release
    cached = { at: Date.now(), release }
    return release
  }

  return {
    async list() {
      const release = await latest()
      if (!release) return null

      return {
        version: release.tag_name.replace(/^v/, ''),
        publishedAt: release.published_at,
        files: release.assets.map((a) => ({ name: a.name, size: a.size }))
      }
    },

    async resolve(name) {
      const release = await latest()
      const asset = release?.assets.find((a) => a.name === name)
      if (!asset) return null

      const response = await api(
        `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
        'application/octet-stream',
        'manual'
      )

      const location = response.headers.get('location')
      if (location) return { redirect: location }

      // Small files, the update feeds among them, come back inline rather than redirected.
      if (response.ok) {
        return {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream'
        }
      }

      return null
    }
  }
}
