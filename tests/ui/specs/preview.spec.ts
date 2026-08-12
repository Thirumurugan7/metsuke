import { test, expect } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot } from '../helpers/stable'

test.describe('preview', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeWorkspace()
    await openWorkspace(app.page, dir)
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('the preview pane opens with its toolbar', async ({ app }) => {
    const { page } = app

    // previewVisible defaults to true (src/renderer/state/store.ts), so the pane is
    // already open once a workspace loads. Clicking the title bar's Preview button here
    // would toggle it closed, not open it, and the toolbar would be clipped to nothing
    // inside a zero-width slot while still passing toBeVisible() (Playwright's
    // visibility check does not account for ancestor clipping). Confirmed by looking at
    // that exact broken baseline before writing this version.
    await expect(page.locator('.preview-bar')).toBeVisible()
    await shot(page, 'preview-open.png')
  })

  test('an unreachable url is explained, not left blank', async ({ app }) => {
    const { page } = app
    await expect(page.locator('.preview-bar')).toBeVisible()

    // Nothing is listening on this port; the pane must say so rather than show blank.
    await page.locator('.preview-bar input').first().fill('http://127.0.0.1:59999')
    await page.keyboard.press('Enter')

    await expect(page.locator('.preview-error')).toBeVisible({ timeout: 30_000 })
    await shot(page, 'preview-error.png')
  })
})
