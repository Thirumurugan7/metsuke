import { test, expect } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot, freeze } from '../helpers/stable'

test.describe('terminals', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeWorkspace()
    await openWorkspace(app.page, dir)
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('opening a folder leaves exactly one claude tab', async ({ app }) => {
    const { page } = app
    // StrictMode has produced a duplicate here twice. One tab, not two.
    await expect(page.locator('.terminal-tab-name', { hasText: /^claude$/ })).toHaveCount(1)
    await expect(page.locator('.terminal-tab-name', { hasText: 'claude 2' })).toHaveCount(0)
    await shot(page, 'terminal-single-tab.png')
  })

  test('a second terminal gets its own tab', async ({ app }) => {
    const { page } = app
    const before = await page.locator('.terminal-tabs .terminal-tab-name').count()

    // TerminalPanel.tsx: the div.terminal-new wraps a single <button aria-label="New
    // terminal">, which opens a role="menu" of role="menuitem" buttons. "Shell" is one
    // of those menuitem buttons, not a regex-guessable label, so match it by its exact
    // visible text.
    await page.getByRole('button', { name: 'New terminal' }).click()
    await page.getByRole('menuitem', { name: 'Shell' }).click()

    await expect(page.locator('.terminal-tabs .terminal-tab-name')).toHaveCount(before + 1)
    await shot(page, 'terminal-two-tabs.png')
  })

  test('sessions survive a renderer reload', async ({ app }) => {
    const { page } = app
    const before = await page.locator('.terminal-tabs .terminal-tab-name').allTextContents()

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.tree-row', { hasText: 'README.md' })).toBeVisible()
    await freeze(page)

    // Terminals belong to the app, not the window. A reload must not kill them.
    await expect(page.locator('.terminal-tabs .terminal-tab-name')).toHaveText(before)
    await shot(page, 'terminal-after-reload.png')
  })
})
