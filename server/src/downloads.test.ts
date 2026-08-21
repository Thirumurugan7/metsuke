import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { manifest, latestFor, directorySource, humanSize, PLATFORMS } from './downloads.js'

/** A release directory, as a server with rsync in its deploy step would have. */
let dir: string

const FEED = `version: 1.4.0
files:
  - url: Metsuke-1.4.0-arm64.dmg
    sha512: AAAAsha512forarm64==
    size: 106899425
  - url: Metsuke-1.4.0-x64.dmg
    sha512: BBBBsha512forx64==
    size: 111504325
path: Metsuke-1.4.0-arm64.dmg
releaseDate: '2026-08-22T00:00:00.000Z'
`

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-dl-'))
  await fs.writeFile(path.join(dir, 'latest-mac.yml'), FEED)
  await fs.writeFile(path.join(dir, 'Metsuke-1.4.0-arm64.dmg'), 'arm64 bytes')
  await fs.writeFile(path.join(dir, 'Metsuke-1.4.0-x64.dmg'), 'x64 bytes')
  await fs.writeFile(path.join(dir, 'Metsuke-1.4.0.exe'), 'windows bytes')
  await fs.writeFile(path.join(dir, 'Metsuke-1.4.0.AppImage'), 'appimage bytes')
  await fs.writeFile(path.join(dir, 'Metsuke-1.4.0-arm64.dmg.blockmap'), 'machinery')
  // Something private that happens to share the parent directory.
  await fs.writeFile(path.join(path.dirname(dir), 'not-yours.txt'), 'secret')
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(path.join(path.dirname(dir), 'not-yours.txt'), { force: true })
})

describe('the manifest', () => {
  it('reads the version from the update feed rather than guessing from a filename', async () => {
    const m = await manifest(directorySource(dir))
    expect(m?.version).toBe('1.4.0')
  })

  it('labels each file with the platform a person would ask for', async () => {
    const m = await manifest(directorySource(dir))
    const byName = Object.fromEntries(m!.assets.map((a) => [a.name, a.platform]))

    expect(byName['Metsuke-1.4.0-arm64.dmg']).toBe('mac-arm64')
    expect(byName['Metsuke-1.4.0-x64.dmg']).toBe('mac-x64')
    expect(byName['Metsuke-1.4.0.exe']).toBe('win')
    expect(byName['Metsuke-1.4.0.AppImage']).toBe('linux-appimage')
  })

  /* The feeds and blockmaps are machinery for the updater, not things anybody downloads. */
  it('leaves the updater machinery out of the list', async () => {
    const m = await manifest(directorySource(dir))
    const names = m!.assets.map((a) => a.name)

    expect(names).not.toContain('latest-mac.yml')
    expect(names.some((n) => n.endsWith('.blockmap'))).toBe(false)
  })

  /*
   * The checksum has to be the one the updater verifies against. Computing a second one
   * here would eventually disagree with the number that actually matters.
   */
  it('takes checksums from the feed', async () => {
    const m = await manifest(directorySource(dir))
    const arm = m!.assets.find((a) => a.platform === 'mac-arm64')

    expect(arm?.sha512).toBe('AAAAsha512forarm64==')
  })

  it('says nothing rather than guessing when a file has no published hash', async () => {
    const m = await manifest(directorySource(dir))
    expect(m!.assets.find((a) => a.platform === 'win')?.sha512).toBeNull()
  })

  it('has an entry for every platform it found', async () => {
    const m = await manifest(directorySource(dir))
    expect(Object.keys(m!.latest).sort()).toEqual(['linux-appimage', 'mac-arm64', 'mac-x64', 'win'])
  })

  it('returns nothing at all for an empty directory', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-empty-'))
    expect(await manifest(directorySource(empty))).toBeNull()
    await fs.rm(empty, { recursive: true, force: true })
  })
})

describe('the stable link', () => {
  it('resolves a platform to the current file', async () => {
    expect(await latestFor(directorySource(dir), 'mac-arm64')).toBe('Metsuke-1.4.0-arm64.dmg')
  })

  it('refuses a platform nobody publishes', async () => {
    expect(await latestFor(directorySource(dir), 'solaris')).toBeNull()
    expect(await latestFor(directorySource(dir), 'linux-deb')).toBeNull()
  })
})

describe('serving a file', () => {
  it('hands back the bytes', async () => {
    const resolved = await directorySource(dir).resolve('Metsuke-1.4.0-arm64.dmg')
    expect(resolved && 'body' in resolved && resolved.body.toString()).toBe('arm64 bytes')
  })

  /*
   * The one thing that must not be got wrong. A name is a filename, and anything that
   * tries to be a path is refused rather than normalised into one.
   */
  it('refuses a name that is trying to be a path', async () => {
    const source = directorySource(dir)
    for (const name of ['../not-yours.txt', '../../etc/passwd', '/etc/passwd', 'sub/../../not-yours.txt']) {
      expect(await source.resolve(name)).toBeNull()
    }
  })

  it('returns nothing for a file that is not there', async () => {
    expect(await directorySource(dir).resolve('Metsuke-9.9.9.dmg')).toBeNull()
  })
})

describe('humanSize', () => {
  it('reads as megabytes until that stops being sensible', () => {
    expect(humanSize(106_899_425)).toBe('107 MB')
    expect(humanSize(2_400_000_000)).toBe('2.4 GB')
  })
})

describe('platform list', () => {
  it('covers what the release workflow actually builds', () => {
    expect(Object.keys(PLATFORMS)).toEqual(['mac-arm64', 'mac-x64', 'win', 'linux-appimage', 'linux-deb'])
  })
})
