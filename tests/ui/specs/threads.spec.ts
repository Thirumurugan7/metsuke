import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixtures'
import { makeRepo, removeDir } from '../helpers/workspace'
import { openWorkspace, shot } from '../helpers/stable'

const exec = promisify(execFile)

test.describe('threads', () => {
  let dir: string

  test.beforeEach(async ({ app }) => {
    dir = await makeRepo()
    await openWorkspace(app.page, dir)
    await app.page.keyboard.press('Meta+Shift+T')
    await expect(app.page.locator('.threads-panel')).toBeVisible()
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('the new-thread sheet states the tradeoff', async ({ app }) => {
    const { page } = app
    await page.locator('.thread-new').click()

    await expect(page.locator('.sheet')).toBeVisible()
    await expect(page.locator('.sheet-mode-title', { hasText: 'Subagent' })).toBeVisible()
    await expect(page.locator('.sheet-mode-title', { hasText: 'Separate instance' })).toBeVisible()
    await shot(page, 'thread-sheet.png')
  })

  test('an instance gets a worktree that exists on disk', async ({ app }) => {
    const { page } = app
    await page.locator('.thread-new').click()
    await page.locator('.sheet-mode', { hasText: 'Separate instance' }).click()
    await page.locator('.sheet-field input').first().fill('Fixture thread')
    await page.getByRole('button', { name: 'Start thread' }).click()

    await expect(page.locator('.thread-row', { hasText: 'Fixture thread' })).toBeVisible()
    await expect(page.locator('.thread-branch', { hasText: 'fixture-thread' })).toBeVisible()

    // The row is not the point; the checkout is.
    const worktree = path.join(dir, '.metsuke/worktrees/fixture-thread')
    await expect
      .poll(async () => fs.stat(worktree).then(() => true, () => false), { timeout: 20_000 })
      .toBe(true)

    // Starting an instance fires the adaptation flourish (Adaptation.tsx), a
    // pointer-events-none overlay that covers the whole viewport for 4.2s. .adapt-wheel
    // is already in the standard mask list, but while it is mounted its mask rectangle
    // is the entire screen, so a shot taken mid-flourish is a solid block of mask colour
    // rather than the panel under test. Wait for it to clear instead of racing it.
    await expect(page.locator('.adapt')).toHaveCount(0, { timeout: 6_000 })

    await shot(page, 'thread-running.png')
  })

  test('closing a thread removes the checkout and keeps the branch', async ({ app }) => {
    const { page } = app
    await page.locator('.thread-new').click()
    await page.locator('.sheet-mode', { hasText: 'Separate instance' }).click()
    await page.locator('.sheet-field input').first().fill('Fixture thread')
    await page.getByRole('button', { name: 'Start thread' }).click()

    const row = page.locator('.thread-row', { hasText: 'Fixture thread' })
    await expect(row).toBeVisible()

    const worktree = path.join(dir, '.metsuke/worktrees/fixture-thread')
    await expect
      .poll(async () => fs.stat(worktree).then(() => true, () => false), { timeout: 20_000 })
      .toBe(true)

    // Wait out the adaptation flourish (see the previous test) before doing anything
    // else, so it cannot still be covering the screen when thread-closed.png is taken.
    await expect(page.locator('.adapt')).toHaveCount(0, { timeout: 6_000 })

    await row.locator('.thread-close').click()

    // It must not come back: killing the pty alone used to respawn it as a new row.
    await expect(row).toHaveCount(0)
    await page.waitForTimeout(2000)
    await expect(row).toHaveCount(0)

    // Stronger than the DOM check above: the app's own thread list, read through the
    // real preload bridge, the same way terminals.spec.ts compares pty session ids
    // rather than tab labels. A respawned pty used to be re-adopted as a fresh thread
    // with no branch and no worktree, which the row-count check alone would not catch
    // if the new row happened to render with the same title.
    const threads = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          api: { invoke: (c: string, ...a: unknown[]) => Promise<{ ok: boolean; value?: unknown }> }
        }
      ).api
      const result = await api.invoke('threads:list')
      if (!result?.ok || !Array.isArray(result.value)) return []
      return result.value as Array<{ title: string; branch: string | null }>
    })
    expect(threads.some((t) => t.title === 'Fixture thread')).toBe(false)

    expect(await fs.stat(worktree).then(() => true, () => false)).toBe(false)

    // The commits are the output of a thread; the branch survives.
    const branches = (await exec('git', ['branch', '--list', 'fixture-thread'], { cwd: dir })).stdout
    expect(branches).toContain('fixture-thread')

    await shot(page, 'thread-closed.png')
  })
})
