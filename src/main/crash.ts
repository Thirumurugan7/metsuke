import { app, dialog, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import { CrashLog } from './services/CrashLog'
import { rendererCrashPolicy } from './services/crashPolicy'

export interface CrashHandlers {
  /** Watch a window's renderer. Call again for a window created after a crash. */
  watch: (window: BrowserWindow) => void
  log: CrashLog
}

/**
 * What happens when something dies.
 *
 * Before this, a renderer crash left a white window with no explanation and a main
 * process crash took everything with it and reported nothing at all: no window, no
 * console, nothing on disk. The user's account of the bug was "it disappeared", which is
 * not something anybody can fix.
 *
 * The rules differ by what died, because the honest response does:
 *
 * - A renderer crash reloads, once. That is invisible recovery in the common case.
 * - An uncaught exception in main is fatal by definition; the process is in an unknown
 *   state and pretending otherwise is how you corrupt a state file. Offer a restart.
 * - An unhandled rejection is not. Killing an editor mid-session over one rejected
 *   promise would be worse than the bug, so it is recorded and left alone.
 * - A GPU or utility child process dying is Chromium's business; it respawns them.
 */
export function installCrashHandlers(recreateWindow: () => void): CrashHandlers {
  const log = new CrashLog(path.join(app.getPath('userData'), 'crashes.log'))

  // Reporting a crash must never be what crashes it, so every path here is defensive.
  let reporting = false
  let lastRendererCrashAt: number | null = null

  const fatal = async (kind: 'uncaught-exception' | 'unhandled-rejection', error: Error, context?: Record<string, unknown>): Promise<void> => {
    if (reporting) return
    reporting = true

    console.error(`[crash] ${kind}:`, error)
    await log.record(kind, error, context).catch(() => {})

    const message = error instanceof Error ? error.message : String(error)
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Metsuke stopped',
      message: 'Metsuke hit an error it cannot recover from.',
      // The message itself, not a generic apology. It is the one thing that makes an
      // issue report useful, and the user is the one who has to carry it there.
      detail: `${message}\n\nWhat you had open is on disk. Terminals do not survive a restart.\n\nDetails were written to:\n${log.path}`,
      buttons: ['Restart', 'Show the log', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })

    if (response === 1) shell.showItemInFolder(log.path)

    if (response === 0) app.relaunch()
    app.exit(1)
  }

  process.on('uncaughtException', (error) => {
    void fatal('uncaught-exception', error)
  })

  process.on('unhandledRejection', (reason) => {
    // Deliberately not fatal. Recorded so a pattern of them is visible after the fact.
    console.error('[crash] unhandled rejection:', reason)
    void log.record('unhandled-rejection', reason as Error).catch(() => {})
  })

  app.on('child-process-gone', (_event, details) => {
    // Chromium respawns these on its own; this is a breadcrumb, not an incident.
    void log
      .record('child-process-gone', new Error(details.reason), {
        type: details.type,
        exitCode: details.exitCode,
        serviceName: details.serviceName ?? ''
      })
      .catch(() => {})
  })

  const watch = (window: BrowserWindow): void => {
    window.webContents.on('render-process-gone', (_event, details) => {
      const now = Date.now()

      console.error('[crash] renderer gone:', details.reason)
      void log
        .record('renderer-gone', new Error(details.reason), {
          reason: details.reason,
          exitCode: details.exitCode
        })
        .catch(() => {})

      // A window the user closed is not a crash. Electron reports 'clean-exit' for it.
      if (details.reason === 'clean-exit') return

      const decision = rendererCrashPolicy(lastRendererCrashAt, now)
      lastRendererCrashAt = now

      if (decision === 'reload') {
        // The window's web contents are gone, so this cannot be a reload(): the window
        // itself has to be rebuilt. Sessions reattach on the way back up, which is what
        // makes this survivable at all.
        if (!window.isDestroyed()) window.destroy()
        recreateWindow()
        return
      }

      void dialog
        .showMessageBox({
          type: 'error',
          title: 'Metsuke keeps crashing',
          message: 'The window crashed twice in a row.',
          detail: `Reloading it again would most likely crash it again.\n\nDetails were written to:\n${log.path}`,
          buttons: ['Restart', 'Show the log', 'Quit'],
          defaultId: 0,
          cancelId: 2,
          noLink: true
        })
        .then(({ response }) => {
          if (response === 1) shell.showItemInFolder(log.path)
          if (response === 0) app.relaunch()
          app.exit(1)
        })
        .catch(() => app.exit(1))
    })
  }

  return { watch, log }
}
