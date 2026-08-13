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

      /*
       * Open the TypeScript fixture rather than the README.
       *
       * Each theme defines its own colour for keyword, type, string, func, comment,
       * number, variable and operator. README.md is a heading and one plain sentence,
       * and Monaco maps a markdown heading to the keyword scope, so capturing it proved
       * exactly one of those eight. A theme shipping a broken string or type colour
       * passed all seven baselines. src/app.ts exercises keyword, type, string and func
       * together, which is four of the eight rather than one.
       *
       * The other four are still not covered here: the fixture has no comment, number,
       * variable or operator token, and adding one would mean changing a file the git
       * spec diffs, so it is left for whoever wants that coverage to do deliberately.
       */
      await page.locator('.tree-row', { hasText: 'src' }).click()
      const file = page.locator('.tree-row', { hasText: 'app.ts' })
      await expect(file).toBeVisible()
      await file.click()

      await expect(page.locator('.monaco-container')).toBeVisible()
      // Proof the editor really rendered the code, so the capture is of a themed
      // editor rather than an empty pane that happens to have the right background.
      await expect(page.locator('.monaco-container')).toContainText('start')

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
