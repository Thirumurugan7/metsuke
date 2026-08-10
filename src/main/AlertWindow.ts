import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NotificationPayload } from '@shared/ipc'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const WIDTH = 380
const HEIGHT = 168
const MARGIN = 18
/** Alerts that are not blocking Claude clear themselves; a permission prompt does not. */
const AUTO_HIDE_MS = 20_000

/**
 * The alert that floats above every application.
 *
 * A DOM modal inside the editor only exists while you are looking at the editor, which
 * is precisely when you least need telling. This is a separate frameless, transparent,
 * always-on-top window: it appears over your browser, your terminal, a fullscreen app,
 * on whichever display your cursor is on.
 *
 * It is shown without taking focus, so it never interrupts what you are typing — unless
 * the user has explicitly asked for the editor to be raised.
 */
export class AlertWindow {
  #window: BrowserWindow | null = null
  #timer: NodeJS.Timeout | null = null
  #ready = false
  /** Held until the page signals it is ready, so no alert is lost on first show. */
  #pending: NotificationPayload | null = null
  /** What is currently on screen, used to protect an unanswered permission prompt. */
  #current: NotificationPayload | null = null

  #ensure(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window

    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Keeps it out of the taskbar and the macOS app switcher — it is a transient
      // alert, not a window you manage.
      skipTaskbar: true,
      hasShadow: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(dirname, '../preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    // 'screen-saver' is the highest ordinary level: it floats above fullscreen apps,
    // which a plain alwaysOnTop does not.
    window.setAlwaysOnTop(true, 'screen-saver')
    // Follow the user across macOS Spaces rather than living on the one it was made in.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    window.on('closed', () => {
      this.#window = null
      this.#ready = false
    })

    const devServer = process.env['ELECTRON_RENDERER_URL']
    void (devServer
      ? window.loadURL(`${devServer}/alert.html`)
      : window.loadFile(path.join(dirname, '../renderer/alert.html')))

    this.#window = window
    return window
  }

  /** Called by the alert page once it can receive a payload. */
  markReady(): void {
    this.#ready = true
    if (this.#pending) {
      const payload = this.#pending
      this.#pending = null
      this.#deliver(payload)
    }
  }

  #deliver(payload: NotificationPayload): void {
    const window = this.#ensure()
    if (!this.#ready) {
      this.#pending = payload
      return
    }
    window.webContents.send('alert:payload', payload)
  }

  /** Show an alert on the display the user is actually looking at. */
  present(payload: NotificationPayload, opts: { takeFocus: boolean }): void {
    const window = this.#ensure()

    // A permission prompt is blocking Claude until you answer it. Anything less urgent
    // arriving afterwards must not overwrite it — an idle notice would replace the text
    // and then take the prompt down with its own auto-hide timer, losing the request.
    const blocking = window.isVisible() && this.#current?.event === 'permission'
    if (blocking && payload.event !== 'permission') return

    // The cursor is the best available proxy for "where the user is" on a multi-monitor
    // desk; putting the alert on the primary display would often be the wrong screen.
    const cursor = screen.getCursorScreenPoint()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    window.setBounds({
      x: Math.round(workArea.x + workArea.width - WIDTH - MARGIN),
      y: Math.round(workArea.y + MARGIN),
      width: WIDTH,
      height: HEIGHT
    })

    this.#deliver(payload)
    this.#current = payload

    // showInactive keeps the keyboard where it was; the alert is still fully clickable.
    if (opts.takeFocus) window.show()
    else window.showInactive()

    // Re-assert: macOS can drop the level when a window is hidden and shown again.
    window.setAlwaysOnTop(true, 'screen-saver')

    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    if (payload.event !== 'permission') {
      this.#timer = setTimeout(() => this.hide(), AUTO_HIDE_MS)
    }
  }

  hide(): void {
    this.#current = null
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    if (this.#window && !this.#window.isDestroyed()) this.#window.hide()
  }

  destroy(): void {
    this.hide()
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy()
    this.#window = null
  }
}
