import { test, expect } from '../fixtures'

test('the welcome screen is what a first run looks like', async ({ app }) => {
  const { page } = app

  // A fresh profile means no last folder, so the app opens on Welcome.
  await expect(page.locator('.title-folder')).toHaveText('No folder open')

  // The claude/git probe spawns real processes and takes over two seconds. Wait for it
  // to land before capturing, or the baseline nondeterministically includes or omits it.
  await page.locator('.welcome-env').waitFor({ state: 'attached', timeout: 10_000 })

  await expect(page).toHaveScreenshot('welcome.png', {
    mask: [
      // The claude/git probe results depend on the machine.
      page.locator('.welcome-env'),
      // Real lsof output: the listening-port rows in the preview footer, the "Ports N"
      // count beside them, and the port count in the status bar. All three change
      // whenever anything on this machine starts or stops listening, including this
      // app's own ephemeral debug ports, so an unmasked baseline is flaky by
      // construction rather than occasionally.
      page.locator('.port-list'),
      page.locator('.preview-footer .count'),
      page.locator('[title="Show listening ports"]')
    ],
    timeout: 15_000
  })
})
