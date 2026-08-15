import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Preferences, DEFAULT_PREFERENCES } from './Preferences'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-prefs-'))
  file = path.join(dir, 'preferences.json')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Preferences', () => {
  it('starts from the defaults when nothing has been saved', async () => {
    const prefs = new Preferences(file)
    await prefs.load()
    expect(prefs.all).toEqual(DEFAULT_PREFERENCES)
  })

  it('checks for updates by default, since an editor that never updates is the bug', async () => {
    expect(DEFAULT_PREFERENCES.autoUpdate).toBe(true)
  })

  it('round-trips a change through the file', async () => {
    const prefs = new Preferences(file)
    await prefs.load()
    await prefs.set({ autoUpdate: false })

    const reopened = new Preferences(file)
    await reopened.load()
    expect(reopened.all.autoUpdate).toBe(false)
  })

  /*
   * A half-written or hand-edited file must not stop the app booting. Preferences are
   * the least important thing in userData and the easiest to rebuild.
   */
  it('falls back to the defaults when the file is corrupt', async () => {
    await fs.writeFile(file, '{ this is not json', 'utf8')
    const prefs = new Preferences(file)
    await prefs.load()
    expect(prefs.all).toEqual(DEFAULT_PREFERENCES)
  })

  it('ignores keys it does not know and values of the wrong type', async () => {
    await fs.writeFile(file, JSON.stringify({ autoUpdate: 'yes please', nonsense: 1 }), 'utf8')
    const prefs = new Preferences(file)
    await prefs.load()
    expect(prefs.all).toEqual(DEFAULT_PREFERENCES)
    expect('nonsense' in prefs.all).toBe(false)
  })

  it('merges rather than replacing, so one setting cannot clear another', async () => {
    const prefs = new Preferences(file)
    await prefs.load()
    await prefs.set({ autoUpdate: false })
    await prefs.set({})
    expect(prefs.all.autoUpdate).toBe(false)
  })

  it('does not lose a write that lands while another is still going', async () => {
    const prefs = new Preferences(file)
    await prefs.load()
    await Promise.all([prefs.set({ autoUpdate: false }), prefs.set({ autoUpdate: true })])

    const reopened = new Preferences(file)
    await reopened.load()
    expect(reopened.all.autoUpdate).toBe(true)
    // Whatever happened, the file has to still be readable JSON.
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toHaveProperty('autoUpdate')
  })

  it('creates the directory if it is not there yet', async () => {
    const nested = new Preferences(path.join(dir, 'deep', 'preferences.json'))
    await nested.load()
    await nested.set({ autoUpdate: false })
    await expect(fs.readFile(path.join(dir, 'deep', 'preferences.json'), 'utf8')).resolves.toContain(
      'autoUpdate'
    )
  })
})
