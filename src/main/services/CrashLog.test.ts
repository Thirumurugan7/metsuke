import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CrashLog } from './CrashLog'

let dir: string
let log: CrashLog

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-crash-'))
  log = new CrashLog(path.join(dir, 'crashes.log'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('CrashLog', () => {
  it('writes the message, the kind and the stack', async () => {
    const error = new Error('cannot read property of undefined')
    await log.record('uncaught-exception', error)

    const text = await fs.readFile(log.path, 'utf8')
    expect(text).toContain('uncaught-exception')
    expect(text).toContain('cannot read property of undefined')
    expect(text).toContain('CrashLog.test.ts')
  })

  it('creates the directory it was pointed at', async () => {
    const nested = new CrashLog(path.join(dir, 'a', 'b', 'crashes.log'))
    await nested.record('renderer-gone', new Error('oom'))
    await expect(fs.readFile(nested.path, 'utf8')).resolves.toContain('oom')
  })

  /*
   * A crash log is read by someone trying to explain a crash that just happened, so the
   * newest entry has to survive. Truncating the front is the only option that keeps it.
   */
  it('keeps the newest entries and drops the oldest when it grows too large', async () => {
    const small = new CrashLog(path.join(dir, 'small.log'), 4_000)
    for (let i = 0; i < 60; i++) await small.record('uncaught-exception', new Error(`boom ${i}`))

    const text = await fs.readFile(small.path, 'utf8')
    expect(text.length).toBeLessThanOrEqual(4_000)
    expect(text).toContain('boom 59')
    expect(text).not.toContain('boom 0\n')
  })

  it('never splits an entry when it truncates', async () => {
    const small = new CrashLog(path.join(dir, 'small.log'), 3_000)
    for (let i = 0; i < 40; i++) await small.record('uncaught-exception', new Error(`boom ${i}`))

    const text = await fs.readFile(small.path, 'utf8')
    expect(text.startsWith('---')).toBe(true)
  })

  it('survives being handed something that is not an Error', async () => {
    await log.record('unhandled-rejection', 'a bare string' as unknown as Error)
    await log.record('unhandled-rejection', undefined as unknown as Error)

    const text = await fs.readFile(log.path, 'utf8')
    expect(text).toContain('a bare string')
    expect(text).toContain('undefined')
  })

  it('records extra context when there is any, such as why a renderer died', async () => {
    await log.record('renderer-gone', new Error('killed'), { reason: 'oom', exitCode: 9 })

    const text = await fs.readFile(log.path, 'utf8')
    expect(text).toContain('reason: oom')
    expect(text).toContain('exitCode: 9')
  })

  it('reports whether anything has ever been written, for the UI to decide on a link', async () => {
    expect(await log.exists()).toBe(false)
    await log.record('uncaught-exception', new Error('x'))
    expect(await log.exists()).toBe(true)
  })

  /*
   * Two crashes at once is exactly when this runs: an exception in main can take the
   * renderer with it. Interleaved writes would corrupt the only account of what happened.
   */
  it('does not interleave concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => log.record('uncaught-exception', new Error(`e${i}`)))
    )

    const text = await fs.readFile(log.path, 'utf8')
    const entries = text.split('--- ').filter(Boolean)
    expect(entries).toHaveLength(12)
    for (let i = 0; i < 12; i++) expect(text).toContain(`e${i}`)
  })
})
