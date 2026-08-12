import { test, expect } from '../fixtures'
import type { Locator } from '@playwright/test'

/**
 * A mask locator that matches nothing is not "nothing to mask", it is a rotted
 * selector: the app changed and the mask silently stopped covering the machine-
 * dependent region it was written for. Fail loud here instead of letting the suite
 * degrade into an occasional, unexplained pixel diff. Task 2 is expected to lift this
 * into the shared masks() helper; kept free-standing and simple until then.
 */
async function assertMasks(masks: { locator: Locator; description: string }[]): Promise<void> {
  for (const { locator, description } of masks) {
    const count = await locator.count()
    if (count === 0) {
      throw new Error(`mask selector matched nothing, it has likely rotted: ${description}`)
    }
  }
}

test('the welcome screen is what a first run looks like', async ({ app }) => {
  const { page } = app

  // A fresh profile means no last folder, so the app opens on Welcome.
  await expect(page.locator('.title-folder')).toHaveText('No folder open')

  // The claude/git probe spawns real processes and takes over two seconds. Wait for it
  // to land before capturing, or the baseline nondeterministically includes or omits it.
  await page.locator('.welcome-env').waitFor({ state: 'attached', timeout: 10_000 })

  const masks = [
    {
      // The claude/git probe results, src/renderer/components/Welcome.tsx.
      locator: page.locator('.welcome-env'),
      description: '.welcome-env (claude/git probe line)'
    },
    {
      // The listening-port rows in the preview footer, PortsPanel.tsx via Preview.tsx.
      locator: page.locator('.port-list'),
      description: '.port-list (preview footer port rows)'
    },
    {
      // The "Ports N" count beside the port rows, Preview.tsx.
      locator: page.locator('.preview-footer .count'),
      description: '.preview-footer .count (ports count badge)'
    },
    {
      // The port count in the status bar. No dedicated class exists on this button
      // (it shares "status-item" with seven unrelated buttons), so it is targeted by
      // its real title attribute, StatusBar.tsx.
      locator: page.locator('[title="Show listening ports"]'),
      description: '[title="Show listening ports"] (status bar port count)'
    },
    {
      // The activity bar's Ports icon carries the same live count as a ".dot" badge,
      // App.tsx. ".dot" is also used by the git-changes badge on the adjacent button,
      // so this is scoped to the Ports button specifically via its aria-label, which
      // is unique among the activity bar's views (Explorer/Source Control/Search/
      // Ports/Threads/Claude).
      locator: page.locator('.activity-bar button[aria-label="Ports"] .dot'),
      description: '.activity-bar button[aria-label="Ports"] .dot (activity bar port badge)'
    },
    {
      // The preview's empty-state copy branches on ports.length > 0, Preview.tsx, so
      // the DOM text itself differs by machine (and could differ run to run on the
      // same machine if listeners start or stop), not just a pixel shift. Scoped to
      // this component's own instance of ".hint" via the wrapping <section
      // className="preview">, since ".hint" and ".panel-empty" are both reused by
      // several other panels.
      locator: page.locator('.preview .panel-empty .hint'),
      description: '.preview .panel-empty .hint (preview empty-state copy)'
    }
  ]

  await assertMasks(masks)

  await expect(page).toHaveScreenshot('welcome.png', {
    mask: masks.map((m) => m.locator),
    timeout: 15_000
  })
})
