import fs from 'node:fs/promises'
import path from 'node:path'
// Named import: js-yaml resolves to its ESM build, which has no default export.
import { load as parseYaml } from 'js-yaml'

/**
 * The download flow, in the shape people expect from a desktop app.
 *
 * Three things make it "formal" rather than a list of links:
 *
 *   - **Stable URLs.** /download/latest/mac-arm64 always means the newest build for that
 *     platform. That is the link you put in a blog post or a README, and it does not rot
 *     when a version ships. Version-pinned links exist too, for support: "install exactly
 *     0.2.1" is a real request.
 *   - **A manifest.** One call describes every artifact with its size and its sha512, so
 *     the page can show what it is about to hand you and a careful person can check it.
 *   - **One contract, two backends.** Where the bytes live is a hosting decision that
 *     should not reach the website or the update client. A GitHub release behind a token
 *     and a directory on a box you own both satisfy this interface, so moving between
 *     them changes an environment variable rather than a URL anybody has bookmarked.
 */

/** The platforms a person can ask for by name, and how to recognise their files. */
export const PLATFORMS = {
  'mac-arm64': { label: 'macOS, Apple silicon', match: (n: string) => n.endsWith('.dmg') && /arm64/i.test(n) },
  'mac-x64': { label: 'macOS, Intel', match: (n: string) => n.endsWith('.dmg') && /x64|intel/i.test(n) },
  win: { label: 'Windows', match: (n: string) => n.endsWith('.exe') },
  'linux-appimage': { label: 'Linux, AppImage', match: (n: string) => n.toLowerCase().endsWith('.appimage') },
  'linux-deb': { label: 'Linux, .deb', match: (n: string) => n.endsWith('.deb') }
} as const

export type PlatformKey = keyof typeof PLATFORMS

export interface Asset {
  name: string
  size: number
  /** From the update feed, which electron-builder generates beside the installers. */
  sha512: string | null
  platform: PlatformKey | null
  url: string
}

export interface Manifest {
  version: string
  publishedAt: string | null
  assets: Asset[]
  /** Which file each platform name resolves to right now. */
  latest: Partial<Record<PlatformKey, string>>
}

/** Where the files are. Both shapes answer the same three questions. */
export interface Source {
  /** Newest version, and every file in it. */
  list(): Promise<{ version: string; publishedAt: string | null; files: Array<{ name: string; size: number }> } | null>
  /** How to hand this file to a browser: a redirect, or bytes. */
  resolve(name: string): Promise<{ redirect: string } | { body: Buffer; contentType: string } | null>
}

const platformFor = (name: string): PlatformKey | null =>
  (Object.entries(PLATFORMS).find(([, p]) => p.match(name))?.[0] as PlatformKey | undefined) ?? null

/**
 * Checksums come out of the update feeds rather than being recomputed.
 *
 * electron-builder already hashes every artifact when it writes latest-mac.yml and its
 * siblings, and that is the same hash the updater verifies against. Publishing a second
 * number computed somewhere else would eventually disagree with the one that matters.
 */
async function checksums(source: Source, files: Array<{ name: string }>): Promise<Map<string, string>> {
  const feeds = files.filter((f) => /^latest.*\.yml$/.test(f.name))
  const found = new Map<string, string>()

  for (const feed of feeds) {
    try {
      const resolved = await source.resolve(feed.name)
      if (!resolved || !('body' in resolved)) continue

      const parsed = parseYaml(resolved.body.toString('utf8')) as { files?: Array<{ url: string; sha512: string }> }
      for (const entry of parsed?.files ?? []) if (entry.url && entry.sha512) found.set(entry.url, entry.sha512)
    } catch {
      // A feed that will not parse costs the checksums for that platform, nothing more.
    }
  }

  return found
}

export async function manifest(source: Source, base = '/download'): Promise<Manifest | null> {
  const release = await source.list()
  if (!release) return null

  const hashes = await checksums(source, release.files)

  const assets: Asset[] = release.files
    // The feeds and blockmaps are machinery for the updater, not things a person downloads.
    .filter((f) => !/\.(yml|blockmap)$/.test(f.name))
    .map((f) => ({
      name: f.name,
      size: f.size,
      sha512: hashes.get(f.name) ?? null,
      platform: platformFor(f.name),
      url: `${base}/${encodeURIComponent(f.name)}`
    }))

  const latest: Partial<Record<PlatformKey, string>> = {}
  for (const key of Object.keys(PLATFORMS) as PlatformKey[]) {
    const asset = assets.find((a) => a.platform === key)
    if (asset) latest[key] = asset.name
  }

  return { version: release.version, publishedAt: release.publishedAt, assets, latest }
}

/** Resolve a platform name to the file it currently means. */
export async function latestFor(source: Source, platform: string): Promise<string | null> {
  if (!(platform in PLATFORMS)) return null
  const m = await manifest(source)
  return m?.latest[platform as PlatformKey] ?? null
}

// ---------------------------------------------------------------------------
// Backend: a directory on a machine you own
// ---------------------------------------------------------------------------

/**
 * Files in a folder, which is what a server with rsync in its deploy step looks like.
 *
 * The version comes from the update feed rather than from a filename, because parsing
 * versions out of filenames is a guessing game that breaks on the first release with a
 * hyphen in it.
 */
export function directorySource(dir: string, base = '/download'): Source {
  return {
    async list() {
      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        return null
      }
      if (names.length === 0) return null

      const files = await Promise.all(
        names.map(async (name) => ({ name, size: (await fs.stat(path.join(dir, name))).size }))
      )

      let version = 'unknown'
      const feed = files.find((f) => /^latest.*\.yml$/.test(f.name))
      if (feed) {
        try {
          const parsed = parseYaml(await fs.readFile(path.join(dir, feed.name), 'utf8')) as { version?: string }
          if (parsed?.version) version = parsed.version
        } catch {
          // Leave it unknown rather than inventing one.
        }
      }

      const newest = Math.max(...(await Promise.all(files.map(async (f) => (await fs.stat(path.join(dir, f.name))).mtimeMs))))
      return { version, publishedAt: new Date(newest).toISOString(), files }
    },

    async resolve(name) {
      // The one thing that must not be got wrong: a name is a filename, never a path.
      if (name.includes('/') || name.includes('\\') || name.includes('..')) return null

      const full = path.join(dir, name)
      if (!path.resolve(full).startsWith(path.resolve(dir))) return null

      try {
        const body = await fs.readFile(full)
        return { body, contentType: name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' }
      } catch {
        return null
      }
    }
  }
}

export const humanSize = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
