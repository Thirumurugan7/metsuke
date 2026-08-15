import fs from 'node:fs/promises'
import path from 'node:path'

/** What killed it. Written verbatim into the entry, so keep these readable. */
export type CrashKind =
  | 'uncaught-exception'
  | 'unhandled-rejection'
  | 'renderer-gone'
  | 'child-process-gone'

/** Past this, the front of the file is dropped. Roughly a hundred crashes. */
const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * An append-only account of everything that took the app down.
 *
 * A crash the user cannot describe is a crash nobody can fix, and the main process dying
 * takes the window and any console with it, so the only place a report can survive is a
 * file. Entries are plain text on purpose: the person reading this is pasting it into an
 * issue, not parsing it.
 */
export class CrashLog {
  readonly #path: string
  readonly #maxBytes: number

  /*
   * Writes are chained rather than fired off in parallel. Two crashes arriving together
   * is the normal case, not the exotic one, since an exception in main can take the
   * renderer with it, and interleaved appends would corrupt the only record of either.
   */
  #tail: Promise<void> = Promise.resolve()

  constructor(file: string, maxBytes: number = DEFAULT_MAX_BYTES) {
    this.#path = file
    this.#maxBytes = maxBytes
  }

  get path(): string {
    return this.#path
  }

  async exists(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.#path)
      return stat.size > 0
    } catch {
      return false
    }
  }

  record(kind: CrashKind, error: Error, context?: Record<string, unknown>): Promise<void> {
    this.#tail = this.#tail.then(() => this.#append(kind, error, context)).catch(() => {})
    return this.#tail
  }

  async #append(kind: CrashKind, error: Error, context?: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(this.#path), { recursive: true })

    const entry = format(kind, error, context)
    await fs.appendFile(this.#path, entry, 'utf8')

    await this.#trim()
  }

  /** Drop whole entries off the front until the file is back under the cap. */
  async #trim(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.#path, 'utf8')
    } catch {
      return
    }
    if (Buffer.byteLength(text) <= this.#maxBytes) return

    // Cutting at an entry boundary matters: half a stack trace reads as a different
    // crash than the one that happened.
    const entries = text.split(/^--- /m).filter(Boolean)
    while (entries.length > 1 && Buffer.byteLength(`--- ${entries.join('--- ')}`) > this.#maxBytes) {
      entries.shift()
    }

    await fs.writeFile(this.#path, `--- ${entries.join('--- ')}`, 'utf8')
  }
}

function format(kind: CrashKind, error: Error, context?: Record<string, unknown>): string {
  // Whatever threw is not required to be an Error. A string, undefined and a rejected
  // promise carrying an object have all reached handlers like this one.
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const lines = [`--- ${new Date().toISOString()}  ${kind}`, message]

  if (context) {
    for (const [key, value] of Object.entries(context)) lines.push(`${key}: ${String(value)}`)
  }
  if (stack) lines.push(stack)

  lines.push('')
  return lines.join('\n')
}
