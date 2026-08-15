import { describe, it, expect } from 'vitest'
import { rendererCrashPolicy, RELOAD_GRACE_MS } from './crashPolicy'

describe('rendererCrashPolicy', () => {
  it('reloads the first time, because one crash is usually one bad frame', () => {
    expect(rendererCrashPolicy(null, 1_000)).toBe('reload')
  })

  it('reloads again once the app has been up a while since the last one', () => {
    expect(rendererCrashPolicy(0, RELOAD_GRACE_MS + 1)).toBe('reload')
  })

  /*
   * Reloading into a renderer that crashes on load is an infinite loop that looks like a
   * flickering window and pins a core. Two crashes inside the grace window means the
   * reload is the problem, so stop and tell the user.
   */
  it('gives up when a second crash lands inside the grace window', () => {
    expect(rendererCrashPolicy(0, RELOAD_GRACE_MS - 1)).toBe('give-up')
  })

  it('treats a crash at the exact boundary as recoverable', () => {
    expect(rendererCrashPolicy(0, RELOAD_GRACE_MS)).toBe('reload')
  })

  it('does not trust a clock that went backwards', () => {
    expect(rendererCrashPolicy(10_000, 5_000)).toBe('give-up')
  })
})
