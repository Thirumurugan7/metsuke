import { test, expect } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot } from '../helpers/stable'

test.describe('core shell', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeWorkspace()
    await openWorkspace(app.page, dir)
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('the file tree expands', async ({ app }) => {
    const { page } = app
    await page.locator('.tree-row', { hasText: 'src' }).click()
    await expect(page.locator('.tree-row', { hasText: 'app.ts' })).toBeVisible()
    await shot(page, 'tree-expanded.png')
  })

  test('opening a file shows it in a tab and in the editor', async ({ app }) => {
    const { page } = app
    await page.locator('.tree-row', { hasText: 'README.md' }).click()

    await expect(page.locator('.tab .tab-name', { hasText: 'README.md' })).toBeVisible()
    await expect(page.locator('.monaco-container')).toBeVisible()
    await shot(page, 'file-open.png')
  })

  test('a click lands on the row it appears to land on', async ({ app }) => {
    const { page } = app
    const row = page.locator('.tree-row', { hasText: 'README.md' })
    const box = await row.boundingBox()
    expect(box).not.toBeNull()

    // Presence is not visibility. Two bugs shipped here from checking the DOM.
    const onTop = await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return hit?.closest('.tree-row')?.textContent?.includes('README.md') ?? false
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
    )
    expect(onTop).toBe(true)
  })

  test('quick open filters as you type', async ({ app }) => {
    const { page } = app
    await page.keyboard.press('Meta+P')
    await expect(page.locator('.quick-open')).toBeVisible()

    await page.keyboard.type('util')
    await expect(page.locator('.quick-open-name', { hasText: 'util.ts' })).toBeVisible()
    await shot(page, 'quick-open.png')
  })

  test('search finds a word across the tree', async ({ app }) => {
    const { page } = app
    await page.keyboard.press('Meta+Shift+F')
    await expect(page.locator('.search-panel')).toBeVisible()

    await page.locator('.search-panel input').first().fill('haystack')
    await page.keyboard.press('Enter')

    await expect(page.locator('.search-file-name', { hasText: 'notes.md' })).toBeVisible()
    await shot(page, 'search-results.png')
  })
})
