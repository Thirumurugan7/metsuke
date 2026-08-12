import { test, expect } from '../fixtures'
import { shot } from '../helpers/stable'

test('the welcome screen is what a first run looks like', async ({ app }) => {
  const { page } = app

  // A fresh profile means no last folder, so the app opens on Welcome.
  await expect(page.locator('.title-folder')).toHaveText('No folder open')

  // The claude/git probe spawns real processes and takes over two seconds. Wait for it
  // to land before capturing, or the baseline nondeterministically includes or omits it.
  await page.locator('.welcome-env').waitFor({ state: 'attached', timeout: 10_000 })

  // .welcome-env is specific to this screen (Welcome.tsx), so it is not part of the
  // shared masks() list; it is proven present by the waitFor above, so passing it
  // through `extra` gets it the same strict rot-check as the standard masks.
  await shot(page, 'welcome.png', [page.locator('.welcome-env')])
})
