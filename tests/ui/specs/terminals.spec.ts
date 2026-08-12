import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures'
import { makeWorkspace, removeDir } from '../helpers/workspace'
import { openWorkspace, shot, freeze } from '../helpers/stable'

/**
 * The live pty session ids the main process is currently holding, read the same way
 * resetApp() in fixtures.ts does: through window.api, the real preload IPC bridge the
 * app itself uses to reach `terminal:list`. This is not window.__store, which is banned
 * and does not exist in the built app; window.api is the genuine contract.
 */
async function getSessionIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const api = (
      window as unknown as {
        api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown }> }
      }
    ).api
    const result = await api.invoke('terminal:list')
    if (!result?.ok || !Array.isArray(result.value)) return []
    return (result.value as Array<{ id: string }>).map((session) => session.id)
  })
}

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

    // Tab labels are not session identity: a killed-and-respawned "claude" pty would
    // still be titled "claude" and pass a text-only comparison. The actual claim is
    // that the pty itself survives, so read its id from the main process, the same way
    // resetApp() in fixtures.ts does, through the real preload bridge (not
    // window.__store, which does not exist in the built app).
    const idsBefore = await getSessionIds(page)
    expect(idsBefore.length).toBeGreaterThan(0)

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.tree-row', { hasText: 'README.md' })).toBeVisible()
    await freeze(page)

    // Terminals belong to the app, not the window. A reload must not kill them: this
    // project has shipped that exact regression (sessions in a workspace subdirectory
    // matched on cwd === root and were killed on every reload), so assert on the pty's
    // own id, not on a label a respawned pty would carry just as well.
    const idsAfter = await getSessionIds(page)
    expect(idsAfter.length).toBeGreaterThan(0)
    expect(new Set(idsAfter)).toEqual(new Set(idsBefore))

    await expect(page.locator('.terminal-tabs .terminal-tab-name')).toHaveText(before)
    await shot(page, 'terminal-after-reload.png')
  })
})
