import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Application preferences that the main process needs before any window exists.
 *
 * Deliberately not localStorage: the update check runs at startup, and the renderer may
 * not have loaded yet when it does. Deliberately not notifications.json either, since
 * that file is about being interrupted and this is not.
 */
export interface AppPreferences {
  /**
   * Check GitHub for a new version on launch and every few hours.
   *
   * On by default, because an editor nobody can update is the complaint this exists to
   * answer. Off is a real choice though: it is the only request the app makes on its
   * own, so leaving it on is what turns "sends nothing anywhere" into "sends one thing".
   */
  autoUpdate: boolean
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  autoUpdate: true
}

export class Preferences {
  readonly #path: string
  #values: AppPreferences = { ...DEFAULT_PREFERENCES }

  /* Writes are chained. Two settings toggled quickly must not interleave into a file
   * that parses as neither. */
  #tail: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.#path = file
  }

  get all(): AppPreferences {
    return { ...this.#values }
  }

  async load(): Promise<AppPreferences> {
    try {
      const raw = JSON.parse(await fs.readFile(this.#path, 'utf8')) as Record<string, unknown>
      this.#values = sanitise(raw)
    } catch {
      // Missing, unreadable, or hand-edited into nonsense. None of those are worth
      // failing a launch over, and the defaults are all recoverable.
      this.#values = { ...DEFAULT_PREFERENCES }
    }
    return this.all
  }

  async set(patch: Partial<AppPreferences>): Promise<AppPreferences> {
    this.#values = sanitise({ ...this.#values, ...patch })

    const snapshot = this.all
    this.#tail = this.#tail.then(async () => {
      await fs.mkdir(path.dirname(this.#path), { recursive: true })
      await fs.writeFile(this.#path, JSON.stringify(snapshot, null, 2), 'utf8')
    })
    await this.#tail

    return this.all
  }
}

/** Keep known keys of the right type, drop everything else back to its default. */
function sanitise(raw: Record<string, unknown>): AppPreferences {
  return {
    autoUpdate: typeof raw['autoUpdate'] === 'boolean' ? raw['autoUpdate'] : DEFAULT_PREFERENCES.autoUpdate
  }
}
