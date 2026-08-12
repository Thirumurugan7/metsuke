import { test, expect } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot, freeze } from '../helpers/stable'

/** Every theme, because each one has to be switched in four places by hand. */
const THEMES = ['dark', 'light', 'jjk', 'naruto', 'demon-slayer', 'evangelion', 'one-piece']

test.describe('chrome', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeWorkspace()
    await openWorkspace(app.page, dir)
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  for (const theme of THEMES) {
    test(`the ${theme} theme reaches every surface`, async ({ app }) => {
      const { page } = app

      // Set it the way the app does, then reload so Monaco and xterm re-theme too.
      await page.evaluate((id) => localStorage.setItem('open-claude.theme', id), theme)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('.tree-row', { hasText: 'README.md' })).toBeVisible()
      await freeze(page)

      await page.locator('.tree-row', { hasText: 'README.md' }).click()
      await expect(page.locator('.monaco-container')).toBeVisible()

      await shot(page, `theme-${theme}.png`)
    })
  }

  test('the guide opens over the editor', async ({ app }) => {
    const { page } = app
    await page.locator('.status-item', { hasText: 'Guide' }).click()

    await expect(page.locator('.guide')).toBeVisible()
    await shot(page, 'guide.png')
  })
})
