/**
 * Fail a promise that never settles, and say which call it was.
 *
 * Chromium's debugger protocol has no deadline of its own: a command whose ack never
 * arrives leaves its promise pending forever. Over the control bridge that surfaces as a
 * request that returns nothing after the caller's own timeout, with no clue in any log
 * about which call was stuck, which is how `preview_scroll` intermittently hanging went
 * unexplained for as long as it did.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([work, deadline])
  } finally {
    // Both paths, including the rejection: an uncleared timer keeps the process alive.
    clearTimeout(timer)
  }
}
