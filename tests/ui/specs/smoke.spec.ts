import { test, expect } from '../fixtures'

test('the welcome screen is what a first run looks like', async ({ app }) => {
  const { page } = app

  // A fresh profile means no last folder, so the app opens on Welcome.
  await expect(page.locator('.title-folder')).toHaveText('No folder open')

  // The claude/git probe spawns real processes and takes over two seconds. Wait for it
  // to land before capturing, or the baseline nondeterministically includes or omits it.
  await page.locator('.welcome-env').waitFor({ state: 'attached', timeout: 10_000 })

  await expect(page).toHaveScreenshot('welcome.png', {
    // The claude/git probe results in .welcome-env depend on the machine.
    mask: [page.locator('.welcome-env')],
    timeout: 15_000
  })
})
