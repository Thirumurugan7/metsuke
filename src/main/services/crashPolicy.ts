/** Two renderer crashes closer together than this and reloading is making it worse. */
export const RELOAD_GRACE_MS = 10_000

/**
 * Whether a renderer that just died is worth reloading.
 *
 * A single renderer crash is usually one bad frame and a reload puts the user straight
 * back to work, which is why it is the default. Reloading into a renderer that crashes
 * during load is an infinite loop, so a second crash inside the grace window stops it.
 */
export function rendererCrashPolicy(
  previousCrashAt: number | null,
  now: number
): 'reload' | 'give-up' {
  if (previousCrashAt === null) return 'reload'

  // A clock that has gone backwards, from an NTP step or a sleep, cannot be used to argue
  // that enough time has passed. Refusing to loop is the safe reading.
  if (now < previousCrashAt) return 'give-up'

  return now - previousCrashAt >= RELOAD_GRACE_MS ? 'reload' : 'give-up'
}
