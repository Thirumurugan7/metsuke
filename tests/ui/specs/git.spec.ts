import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixtures'
import { makeRepo, removeDir } from '../helpers/workspace'
import { openWorkspace, shot } from '../helpers/stable'

const exec = promisify(execFile)

test.describe('git', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeRepo()
    // A change to show in the status list.
    await fs.writeFile(path.join(dir, 'src/app.ts'), 'export function start(): string {\n  return "changed"\n}\n')
    await openWorkspace(app.page, dir)
    await app.page.keyboard.press('Meta+Shift+G')
    await expect(app.page.locator('.git-panel')).toBeVisible()
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('a modified file appears in the status list', async ({ app }) => {
    const { page } = app
    await expect(page.locator('.git-row', { hasText: 'app.ts' })).toBeVisible()
    await shot(page, 'git-dirty.png')
  })

  test('committing reaches git log on disk', async ({ app }) => {
    const { page } = app
    const row = page.locator('.git-row', { hasText: 'app.ts' })

    // GitPanel.tsx renders the stage control as an icon-only button whose visible
    // label is just "+"; its accessible name comes from an aria-label of
    // `Stage ${file.path}` (Section()'s `action.title` is "Stage" for the unstaged
    // section). Scope on that aria-label rather than visible text or a role/name
    // regex against the page, since the row also carries a "Discard changes ..."
    // button the brief's "/stage/i" guess would otherwise have to avoid by luck.
    await row.hover()
    await row.locator('button[aria-label^="Stage "]').click()

    // The commit box is a <textarea aria-label="Commit message">, not an <input>.
    await page.locator('.git-commit textarea').fill('Change the return value')

    // The commit button's visible text changes with state ("Stage all & commit (1)"
    // vs "Commit 1 staged file"), so match it by its stable "primary" class inside
    // .git-commit rather than by a "/^commit/i" name regex that only happens to work
    // after staging has already flipped the label to start with "Commit".
    await page.locator('.git-commit button.primary').click()

    // The real check: git itself, not the panel's own rendering of it.
    await expect
      .poll(async () => (await exec('git', ['log', '-1', '--format=%s'], { cwd: dir })).stdout.trim(), {
        timeout: 15_000
      })
      .toBe('Change the return value')

    await shot(page, 'git-after-commit.png')
  })

  test('the diff view renders a change', async ({ app }) => {
    const { page } = app
    await page.locator('.git-row', { hasText: 'app.ts' }).click()

    await expect(page.locator('.diff-view')).toBeVisible()
    // `.diff-added` is the header's "+N lines added" stat badge (DiffView.tsx), which
    // renders unconditionally, even as "+0" with no changes, so asserting on it alone
    // proves nothing. The actual added line in the patch body carries the class
    // `diff-add` (`diff-line diff-${line.kind}`), which is what should be asserted.
    await expect(page.locator('.diff-line.diff-add').first()).toBeVisible()
    await shot(page, 'git-diff.png')
  })
})
