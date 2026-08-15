import { describe, it, expect } from 'vitest'
import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
  it('passes a value straight through when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'Page.enable')).resolves.toBe('ok')
  })

  it('passes the original rejection through rather than masking it as a timeout', async () => {
    const failed = Promise.reject(new Error('node not found'))
    await expect(withTimeout(failed, 50, 'DOM.getBoxModel')).rejects.toThrow('node not found')
  })

  it('names the stuck call, because that is the whole point of the message', async () => {
    const never = new Promise(() => {})
    await expect(withTimeout(never, 10, 'Input.dispatchMouseEvent')).rejects.toThrow(
      /Input\.dispatchMouseEvent/
    )
    await expect(withTimeout(never, 10, 'Input.dispatchMouseEvent')).rejects.toThrow(/10 ?ms/)
  })

  /*
   * A timer left running holds the event loop open, which in the main process means a
   * quit that hangs rather than one bad call that reported itself.
   */
  it('clears its timer as soon as the work settles', async () => {
    const before = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0
    await withTimeout(Promise.resolve(1), 60_000, 'Page.captureScreenshot')
    const after = process.getActiveResourcesInfo?.().filter((r) => r === 'Timeout').length ?? 0
    expect(after).toBe(before)
  })
})
