import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Open a folder without touching the native dialog.
 *
 * The picker cannot be automated, but the startup restore can: seeding the same
 * localStorage keys the app writes itself and reloading makes it open the folder
 * through its own normal path. autoCheck is turned off so opening does not send the
 * project-check prompt to a real Claude session.
 */
export async function openWorkspace(page: Page, dir: string): Promise<void> {
  await page.evaluate((root) => {
    localStorage.setItem('open-claude.lastFolder', root)
    localStorage.setItem('open-claude.autoCheck', 'off')
    localStorage.setItem('open-claude.theme', 'dark')
  }, dir)

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  // The tree is the signal the folder is genuinely open, not just requested.
  await expect(page.locator('.tree-row', { hasText: 'README.md' })).toBeVisible()

  await waitForPortsSettled(page)
  await freeze(page)
}

/**
 * `ports:list` (src/renderer/state/store.ts) is fired once at store init and resolves
 * asynchronously; nothing in the app gates rendering on it. Its result decides which of
 * two structurally different branches PortsPanel renders (a `.port-list` of rows, or an
 * empty-state message), which have different heights and can shift surrounding layout.
 * If that resolution lands between two captures of an otherwise-unchanged screen (as
 * stability.spec.ts takes), the second capture can differ from the first even though
 * nothing the test did actually changed, because a layout reflow moved pixels outside
 * of any mask.
 *
 * Never observed to flake in practice: a local port scan resolves in well under a
 * second. But "not yet observed" is not "structurally guaranteed", and the brief asks
 * for the latter, so wait for it explicitly rather than trust timing.
 *
 * There is no window.__store to read the resolved value from directly, and there
 * should not be: it does not exist in the built app. Instead this polls a DOM value
 * that is always present regardless of workspace or sidebar state and that changes
 * exactly when the ports state changes: the status bar's "N ports" button
 * (StatusBar.tsx). Waiting for that text to stop moving is waiting for the same
 * underlying event a direct store read would wait for, observed the only way tests are
 * allowed to observe it. Same stabilize-by-polling shape as frontmost() in fixtures.ts.
 */
async function waitForPortsSettled(page: Page): Promise<void> {
  const portsButton = page.locator('[title="Show listening ports"]')
  const startedAt = Date.now()
  const deadline = startedAt + 3_000
  const floorMs = 1_000

  /*
   * `ports` starts as [] in the store, so the button shows its empty value from first
   * paint. Stability alone therefore proves nothing: three unchanged reads cannot tell
   * "the scan resolved and this is the answer" from "the scan has not come back and this
   * is still the default". Waiting for a change is not a fix either, since a machine with
   * genuinely nothing listening never changes it.
   *
   * So accept either signal: the text moved off its initial value, which proves the scan
   * landed, or a floor of time passed with it unchanged, which is the best available
   * evidence that the empty value is the real one.
   */
  const initial = await portsButton.textContent().catch(() => null)
  let lastText = initial
  let stableReads = 0

  while (Date.now() < deadline) {
    const text = await portsButton.textContent().catch(() => null)
    if (text !== null && text !== initial) return

    if (text !== null && text === lastText) {
      stableReads++
      if (stableReads >= 3 && Date.now() - startedAt >= floorMs) return
    } else {
      stableReads = 0
      lastText = text
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  // Never hang the suite over this. Every port region is masked and the footer height is
  // pinned, so a late resolution costs a mask covering slightly the wrong thing rather
  // than the wholesale layout shift this exists to prevent.
}

/** Kill anything that moves, so a capture is never taken mid-flight. */
export async function freeze(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Idempotent: shot() calls this before every capture and openWorkspace() calls it
    // again after its reload drops injected styles, so re-adding would pile up tags.
    if (document.getElementById('ui-test-freeze')) return

    const style = document.createElement('style')
    style.id = 'ui-test-freeze'
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      /*
       * Pin the height of regions whose content is live.
       *
       * Masking hides what a region says, but not how tall it is. The ports footer grows
       * and shrinks with the number of listening sockets on the machine, and every pixel
       * it moves pushes the whole preview column and the status bar down with it, so a
       * run fails on a vertical shift that has nothing to do with the change under test.
       * Pinning to the maximum height the stylesheet already allows makes the layout
       * identical whether the machine has three listeners or thirty.
       */
      .preview-footer {
        height: 220px !important;
        max-height: 220px !important;
        min-height: 220px !important;
        overflow: hidden !important;
      }`
    document.head.appendChild(style)
  })
}

/**
 * Regions whose content is live and cannot be pinned, and whether a locator matching
 * zero elements is expected or a sign of rot.
 *
 * 'always': mounted unconditionally once the app has loaded, confirmed by reading the
 * components that render each one (TerminalPanel, Preview, StatusBar all render their
 * containers regardless of state; the panel is CSS-hidden, not unmounted, when its
 * splitter is collapsed, per the "Panels are hidden with CSS rather than unmounted"
 * comment in App.tsx). A zero count here means the selector no longer matches anything
 * the app renders, i.e. it rotted.
 *
 * 'conditional': only exists under state a given screen may or may not be in: a live
 * listening port (.port-list, the activity-bar dot), a page loaded into the preview
 * (.preview-webview, the inverse of .panel-empty .hint), or a specific sidebar view
 * being selected (ThreadsPanel, GitPanel and ClaudePanel are each mounted only while
 * their view is active, per the `{sidebar === 'x' && <X />}` pattern in App.tsx, unlike
 * the terminal/preview panels). Zero is the common case for most screens and is not
 * evidence of rot by itself.
 */
interface MaskDef {
  locator: Locator
  description: string
  when: 'always' | 'conditional'
}

function maskDefs(page: Page): MaskDef[] {
  return [
    {
      locator: page.locator('.terminal-body'),
      description: '.terminal-body (live pty output, masked wholesale)',
      when: 'always'
    },
    {
      locator: page.locator('.preview-footer .count'),
      description: '.preview-footer .count (ports count badge)',
      when: 'always'
    },
    {
      locator: page.locator('[title="Show listening ports"]'),
      description: '[title="Show listening ports"] (status bar port count)',
      when: 'always'
    },
    {
      locator: page.locator('.port-list'),
      description: '.port-list (preview footer port rows, only when a port is listening)',
      when: 'conditional'
    },
    {
      locator: page.locator('.activity-bar button[aria-label="Ports"] .dot'),
      description: '.activity-bar button[aria-label="Ports"] .dot (activity bar port badge)',
      when: 'conditional'
    },
    {
      locator: page.locator('.preview .panel-empty .hint'),
      description: '.preview .panel-empty .hint (preview empty-state copy)',
      when: 'conditional'
    },
    {
      locator: page.locator('.preview-webview'),
      description: '.preview-webview (a page loaded into the preview)',
      when: 'conditional'
    },
    {
      locator: page.locator('.thread-age'),
      description: '.thread-age (Threads sidebar)',
      when: 'conditional'
    },
    {
      locator: page.locator('.claude-panel'),
      description: '.claude-panel (Claude sidebar)',
      when: 'conditional'
    },
    {
      locator: page.locator('.log-hash'),
      description: '.log-hash (Git sidebar log view)',
      when: 'conditional'
    },
    {
      locator: page.locator('.log-author'),
      description: '.log-author (Git sidebar log view)',
      when: 'conditional'
    },
    {
      locator: page.locator('.adapt-wheel'),
      description: '.adapt-wheel (adaptation flourish)',
      when: 'conditional'
    }
  ]
}

/** The standard mask locators, for use directly against `toHaveScreenshot`'s `mask`. */
export function masks(page: Page): Locator[] {
  return maskDefs(page).map((def) => def.locator)
}

/**
 * A mask locator that matches nothing is not always "nothing to mask": for the
 * 'always' regions it is a rotted selector, because the app changed and the mask
 * silently stopped covering the region it was written for. Fail loud there. For
 * 'conditional' regions, zero is the ordinary case on most screens, so it is not
 * checked here; a caller that has put the screen into the state where a conditional
 * region should exist can pass it through shot()'s `extra`, which is checked strictly
 * because the caller has already proven, by navigating there, that it should exist.
 */
async function assertMasks(defs: MaskDef[]): Promise<void> {
  for (const { locator, description, when } of defs) {
    if (when !== 'always') continue
    const count = await locator.count()
    if (count === 0) {
      throw new Error(`mask selector matched nothing, it has likely rotted: ${description}`)
    }
  }
}

async function assertExtra(name: string, extra: Locator[]): Promise<void> {
  for (const locator of extra) {
    const count = await locator.count()
    if (count === 0) {
      throw new Error(
        `extra mask passed to shot('${name}') matched nothing: it was expected to exist ` +
          `on this screen, so this is very likely a rotted selector, not an absent region`
      )
    }
  }
}

/**
 * Refuse to capture when a mask has swallowed the screen.
 *
 * This exists because of a failure that is invisible and permanent. `.adapt-wheel` is in
 * the mask list above, but the adaptation flourish it belongs to is a position: fixed,
 * inset: 0 overlay, so while it is on screen its mask rectangle covers everything. A
 * baseline captured in that moment is a solid block of mask colour, and the next run
 * produces the same solid block, so the comparison passes forever while asserting
 * nothing at all. Two baselines were generated in exactly that state before anyone
 * noticed, and only noticed by a human looking at the images.
 *
 * A test that cannot fail is worse than a missing test, so treat it as fatal rather than
 * leaving it to be caught by eye. The threshold is deliberately loose: the largest
 * legitimate mask in this suite is the preview column at roughly a quarter of the
 * viewport, so half is far above anything real and well below a full-screen overlay.
 */
async function assertNoBlindingMask(page: Page, locators: Locator[]): Promise<void> {
  const MAX_FRACTION = 0.5

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  const area = viewport.width * viewport.height
  if (area === 0) return

  for (const locator of locators) {
    for (const box of await locator.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
    )) {
      const fraction = (box.width * box.height) / area
      if (fraction > MAX_FRACTION) {
        throw new Error(
          `a mask covers ${Math.round(fraction * 100)}% of the viewport, so this capture ` +
            `would assert almost nothing. Something full-screen is probably on top, such ` +
            `as the adaptation overlay. Wait for it to clear before capturing.`
        )
      }
    }
  }
}

/** One capture, with the standard masks and a timeout that names the known trap. */
export async function shot(page: Page, name: string, extra: Locator[] = []): Promise<void> {
  // Every capture, not just the ones that went through openWorkspace(): a spec that
  // never opens a folder still needs animations stopped and live regions pinned.
  await freeze(page)

  const defs = maskDefs(page)
  await assertMasks(defs)
  await assertExtra(name, extra)

  const all = [...defs.map((def) => def.locator), ...extra]
  await assertNoBlindingMask(page, all)

  await expect(page).toHaveScreenshot(name, {
    mask: [...defs.map((def) => def.locator), ...extra],
    // A hang here means the window lost focus; fail loudly rather than wedging the run.
    timeout: 15_000
  })
}
