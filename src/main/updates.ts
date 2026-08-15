import { app, type BrowserWindow } from 'electron'
import path from 'node:path'
import type { UpdateState } from '@shared/ipc'
import { Preferences } from './services/Preferences'

/** How often to look, once the app has been running a while. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Long enough after launch that it never competes with opening a folder. */
const FIRST_CHECK_DELAY_MS = 30_000

/**
 * Updating the app, which until now did not happen at all: whoever downloaded 0.1.0 was
 * going to be running 0.1.0 forever.
 *
 * Two things make this more delicate than the usual electron-updater wiring.
 *
 * It is the only request this app makes on its own, and the README makes a point of
 * saying so, so it is a preference rather than a fact of life, and it is named plainly
 * in the settings panel rather than buried.
 *
 * And installing means quitting, which kills every terminal and every running `claude`
 * session. So nothing here ever installs on its own. It downloads, says a version is
 * ready, and waits to be asked, which is why the status is pushed to the renderer
 * instead of ending in a dialog that steals the moment.
 */
export class UpdateService {
  readonly #prefs: Preferences
  #state: UpdateState = {
    status: 'idle',
    version: null,
    percent: null,
    error: null,
    checkedAt: null
  }

  #timer: NodeJS.Timeout | null = null
  #getWindow: () => BrowserWindow | null = () => null
  /** electron-updater, imported lazily. See #updater. */
  #impl: typeof import('electron-updater').autoUpdater | null = null

  constructor(userDataDir: string) {
    this.#prefs = new Preferences(path.join(userDataDir, 'preferences.json'))
  }

  get state(): UpdateState & { enabled: boolean } {
    return { ...this.#state, enabled: this.#prefs.all.autoUpdate }
  }

  async start(getWindow: () => BrowserWindow | null): Promise<void> {
    this.#getWindow = getWindow
    await this.#prefs.load()

    /*
     * A run from the repo has no release to compare against and electron-updater throws
     * rather than shrugging, so it is reported as unsupported and never wired up. The
     * status bar then says why instead of showing a check that can never succeed.
     */
    if (!app.isPackaged) {
      this.#set({ status: 'unsupported' })
      return
    }

    if (!this.#prefs.all.autoUpdate) return
    this.#schedule()
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.#prefs.set({ autoUpdate: enabled })

    if (!enabled) {
      if (this.#timer) clearInterval(this.#timer)
      this.#timer = null
      this.#set({ status: app.isPackaged ? 'idle' : 'unsupported', percent: null, error: null })
      return
    }

    if (!app.isPackaged) return
    this.#schedule()
    // Check straight away, so switching it on gives an answer rather than a shrug.
    void this.check()
  }

  async check(): Promise<void> {
    if (!app.isPackaged || !this.#prefs.all.autoUpdate) return
    if (this.#state.status === 'checking' || this.#state.status === 'downloading') return
    if (this.#state.status === 'ready') return

    this.#set({ status: 'checking', error: null })
    try {
      const updater = await this.#updater()
      await updater.checkForUpdates()
    } catch (error) {
      // A failed check is not worth interrupting anyone over. It lands in the status bar
      // tooltip and the next scheduled check tries again.
      this.#set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now()
      })
    }
  }

  async install(): Promise<void> {
    if (this.#state.status !== 'ready') return
    const updater = await this.#updater()
    // Terminals die here. The renderer warns before calling this.
    updater.quitAndInstall()
  }

  #schedule(): void {
    if (this.#timer) return
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS)
    this.#timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  /**
   * Imported on first use rather than at module load.
   *
   * electron-updater reads app paths and writes a cache directory as it initialises, so
   * importing it eagerly would run all of that in every dev run and every unit test for
   * a feature that only exists in a packaged build.
   */
  async #updater(): Promise<typeof import('electron-updater').autoUpdater> {
    if (this.#impl) return this.#impl

    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = true
    // Never on quit. Quitting is when the user expects the app to be gone, not busy.
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('update-available', (info) =>
      this.#set({ status: 'downloading', version: info.version, percent: 0 })
    )
    autoUpdater.on('update-not-available', () =>
      this.#set({ status: 'idle', version: null, percent: null, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (progress) =>
      this.#set({ status: 'downloading', percent: Math.round(progress.percent) })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.#set({ status: 'ready', version: info.version, percent: 100, checkedAt: Date.now() })
    )
    autoUpdater.on('error', (error) =>
      this.#set({ status: 'error', error: error.message, checkedAt: Date.now() })
    )

    this.#impl = autoUpdater
    return autoUpdater
  }

  #set(patch: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...patch }

    const window = this.#getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('updates:state', this.#state)
    }
  }
}
