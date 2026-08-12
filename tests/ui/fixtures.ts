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

/** Bounds every capture is taken at. Baselines are meaningless without this. */
export const WINDOW = { x: 0, y: 0, width: 1400, height: 900 }

export const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use) => {
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-claude-ui-'))

    /*
     * A throwaway profile per file. Electron honours Chromium's --user-data-dir, so
     * every run starts from genuine first-run state and none of this can reach the
     * real config, which dev and packaged builds already share and clobber.
     */
    const electronApp = await electron.launch({
      args: [appRoot, `--user-data-dir=${profileDir}`],
      cwd: appRoot
    })

    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await frontmost(electronApp)

    await use({ page, electronApp, profileDir })

    await electronApp.close()
    await fs.rm(profileDir, { recursive: true, force: true })
  }
})

/**
 * Put the window genuinely in front, at fixed bounds, from the main process.
 *
 * Page.captureScreenshot hangs when the window is occluded, because the compositor
 * stops producing frames. That is a real trap in this project, not a theoretical one.
 * Forcing the window frontmost keeps frames coming; `shot` still races a timeout in
 * case it does not.
 */
export async function frontmost(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    win.setBounds(bounds)
    win.show()
    win.moveTop()
    win.setAlwaysOnTop(true)
  }, WINDOW)
}

export { expect }
