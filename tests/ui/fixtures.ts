import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export interface AppFixture {
  page: Page
  electronApp: ElectronApplication
  profileDir: string
}

/**
 * Bounds every capture is taken at. The size is fixed because baselines are meaningless
 * without it; the x is off-screen on purpose, so a suite run never appears on the user's
 * desktop or takes focus from what they are doing. Captures still work from there,
 * because the anti-throttling launch flags keep frames flowing regardless of where the
 * window sits or whether anything can see it.
 */
export const WINDOW = { x: -2400, y: 0, width: 1400, height: 900 }

export const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-claude-ui-'))

    /*
     * A throwaway profile per file. Electron honours Chromium's --user-data-dir, so
     * every run starts from genuine first-run state and none of this can reach the
     * real config, which dev and packaged builds already share and clobber.
     */
    const electronApp = await electron.launch({
      args: [
        appRoot,
        `--user-data-dir=${profileDir}`,
        /*
         * Keep frames coming without stealing the screen.
         *
         * The capture hang happens because Chromium stops producing frames for a window
         * it considers occluded or backgrounded. Fighting that by forcing the window in
         * front of everything works, but it makes the machine unusable while the suite
         * runs: the window jumps to the foreground and takes focus on every poll tick.
         * These flags disable the throttling itself, which is the actual cause, so the
         * window can sit unfocused and behind other work and still be captured.
         */
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
      ],
      cwd: appRoot
    })

    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await settleWindow(electronApp)

    await use({ page, electronApp, profileDir })

    await electronApp.close()
    await fs.rm(profileDir, { recursive: true, force: true })
  }
})

/**
 * Settle the window at fixed bounds, parked off-screen, without taking over the display.
 *
 * Captures need two things: frames, and a stable size. Frames come from the
 * anti-throttling launch flags rather than from being frontmost, so nothing here raises
 * or pins the window. It is shown once, inactive, off the side of the desktop, and left
 * alone. You can keep working while the suite runs.
 *
 * An earlier version called show(), moveTop() and setAlwaysOnTop(true) on every tick of
 * the poll loop below, which slammed the window to the foreground hundreds of times per
 * launch and made the machine unusable for the length of a run.
 */
export async function settleWindow(electronApp: ElectronApplication): Promise<void> {
  /*
   * setBounds does not stick on the first try, and checking the native window's
   * getContentSize() is not enough to prove it: that reads back correct almost
   * immediately, because `window.on('ready-to-show', () => window.show())` in
   * src/main/index.ts fires on its own schedule during app boot and can nudge the
   * window after we have already set bounds, while getContentSize() itself moves in
   * lockstep with our own setBounds calls the whole time. What actually lags is
   * Chromium's own viewport inside the renderer, which is what a screenshot reflects.
   *
   * Root cause, found by instrumenting a real stuck run: this machine's screen work
   * area is 1470x923, smaller than the 1600x1000 the window is constructed at in
   * src/main/index.ts. macOS clamps that oversized initial window to fit the screen,
   * and on some launches the renderer's viewport latches onto the clamped size and
   * never receives the follow-up resize notification for our smaller WINDOW bounds,
   * even though the native BrowserWindow object correctly reports 1400x900 the whole
   * time. Waiting longer does not help; a run that lands in this state stays stuck
   * indefinitely. What does help, verified directly: an actual size change forces
   * Chromium to re-notify the renderer, so if the viewport has not matched after a
   * few ticks, resize away to a visibly different size and back rather than repeating
   * the same setBounds call the renderer already appears to have ignored once.
   */
  const page = electronApp.windows()[0]
  const deadline = Date.now() + 10_000
  const stableReadsRequired = 5
  const nudgeAfterTicks = 4
  let stableReads = 0
  let ticksSinceNudge = 0

  // Show it once, without focus. Repeating this inside the poll loop is what made the
  // window slam to the foreground hundreds of times per launch.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isVisible()) win.showInactive()
  })

  for (;;) {
    await electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0]?.setBounds(bounds)
    }, WINDOW)

    const viewport = page
      ? await page
          .evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
          .catch(() => null)
      : null

    if (viewport && viewport.width === WINDOW.width && viewport.height === WINDOW.height) {
      stableReads++
      if (stableReads >= stableReadsRequired) return
    } else {
      stableReads = 0
      ticksSinceNudge++
      if (ticksSinceNudge >= nudgeAfterTicks) {
        ticksSinceNudge = 0
        await electronApp.evaluate(({ BrowserWindow }, bounds) => {
          const win = BrowserWindow.getAllWindows()[0]
          // A different size, because the renderer needs to see an actual change and has
          // already shown it can ignore a repeat of the target bounds. Same off-screen x,
          // so the nudge never flashes the window across the user's desktop.
          win?.setBounds({ x: bounds.x, y: bounds.y, width: 900, height: 600 })
        }, WINDOW)
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `settleWindow(): page viewport never settled to ${WINDOW.width}x${WINDOW.height}` +
          ` (last saw ${viewport ? `${viewport.width}x${viewport.height}` : 'unknown'})`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

export { expect }
