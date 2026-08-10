import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitService } from './GitService'

const exec = promisify(execFile)

/** A real repo in a temp dir — parsing git output is only worth testing against real git. */
async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeeditor-git-'))
  const run = (args: string[]) => exec('git', args, { cwd: dir })
  await run(['init', '-q', '-b', 'main'])
  await run(['config', 'user.email', 'test@example.com'])
  await run(['config', 'user.name', 'Test'])
  await run(['config', 'commit.gpgsign', 'false'])
  await fs.writeFile(path.join(dir, 'README.md'), '# hello\n')
  await run(['add', '.'])
  await run(['commit', '-q', '-m', 'initial'])
  return dir
}

describe('GitService.parseStatus', () => {
  it('reads branch, ahead, and behind from the header', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -3'
    ].join('\0')

    const status = GitService.parseStatus(raw)
    expect(status.branch).toBe('feature/x')
    expect(status.upstream).toBe('origin/feature/x')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(3)
    expect(status.detached).toBe(false)
  })

  it('flags a detached HEAD instead of naming it as a branch', () => {
    const status = GitService.parseStatus('# branch.head (detached)\0')
    expect(status.detached).toBe(true)
    expect(status.branch).toBeNull()
  })

  it('separates the staged and unstaged sides of one file', () => {
    // Staged modification plus a further unstaged modification.
    const raw = '1 MM N... 100644 100644 100644 aaa bbb src/app.ts\0'
    const [file] = GitService.parseStatus(raw).files
    expect(file).toMatchObject({ path: 'src/app.ts', staged: 'modified', unstaged: 'modified' })
  })

  it('keeps paths containing spaces intact', () => {
    const raw = '1 .M N... 100644 100644 100644 aaa bbb my docs/some file.md\0'
    expect(GitService.parseStatus(raw).files[0].path).toBe('my docs/some file.md')
  })

  it('consumes the extra field a rename record carries', () => {
    const raw = ['2 R. N... 100644 100644 100644 aaa bbb R100 new.ts', 'old.ts', '? other.ts', ''].join(
      '\0'
    )
    const { files } = GitService.parseStatus(raw)
    expect(files).toHaveLength(2)
    expect(files.find((f) => f.path === 'new.ts')).toMatchObject({
      staged: 'renamed',
      origPath: 'old.ts'
    })
    // The record after a rename must not be swallowed by the origPath read.
    expect(files.find((f) => f.path === 'other.ts')).toMatchObject({ unstaged: 'untracked' })
  })

  it('marks unmerged entries conflicted on both sides', () => {
    const raw = 'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts\0'
    expect(GitService.parseStatus(raw).files[0]).toMatchObject({
      path: 'conflict.ts',
      staged: 'conflicted',
      unstaged: 'conflicted'
    })
  })
})

describe('GitService against a real repository', () => {
  let dir: string
  let git: GitService

  beforeEach(async () => {
    dir = await makeRepo()
    git = new GitService(dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reports a clean tree on a fresh repo', async () => {
    const status = await git.status()
    expect(status.branch).toBe('main')
    expect(status.files).toEqual([])
  })

  it('sees an untracked file, then sees it staged', async () => {
    await fs.writeFile(path.join(dir, 'new.txt'), 'hi\n')

    let status = await git.status()
    expect(status.files).toHaveLength(1)
    expect(status.files[0]).toMatchObject({ path: 'new.txt', unstaged: 'untracked' })

    await git.stage(['new.txt'])
    status = await git.status()
    expect(status.files[0]).toMatchObject({ path: 'new.txt', staged: 'added' })
  })

  it('stages a deletion', async () => {
    await fs.rm(path.join(dir, 'README.md'))
    await git.stage(['README.md'])
    const status = await git.status()
    expect(status.files[0]).toMatchObject({ path: 'README.md', staged: 'deleted' })
  })

  it('produces an all-additions diff for an untracked file', async () => {
    await fs.writeFile(path.join(dir, 'fresh.txt'), 'line one\nline two\n')
    const diff = await git.diff('fresh.txt', 'worktree')
    expect(diff.patch).toContain('+line one')
    expect(diff.patch).toContain('+line two')
    expect(diff.binary).toBe(false)
  })

  it('separates staged and unstaged diffs for the same file', async () => {
    await fs.writeFile(path.join(dir, 'README.md'), '# hello\nstaged line\n')
    await git.stage(['README.md'])
    await fs.writeFile(path.join(dir, 'README.md'), '# hello\nstaged line\nunstaged line\n')

    expect(await git.diff('README.md', 'staged')).toMatchObject({
      patch: expect.stringContaining('+staged line')
    })
    const worktree = await git.diff('README.md', 'worktree')
    expect(worktree.patch).toContain('+unstaged line')
    expect(worktree.patch).not.toContain('+staged line')
  })

  it('commits the index and returns the new short hash', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'a\n')
    await git.stage(['a.txt'])
    const hash = await git.commit('add a', {})

    expect(hash).toMatch(/^[0-9a-f]{7,}$/)
    expect((await git.status()).files).toEqual([])
    expect((await git.log({ limit: 1 }))[0].subject).toBe('add a')
  })

  it('refuses an empty commit message', async () => {
    await expect(git.commit('   ', {})).rejects.toThrow(/empty/i)
  })

  it('unstages without touching the worktree', async () => {
    await fs.writeFile(path.join(dir, 'b.txt'), 'b\n')
    await git.stage(['b.txt'])
    await git.unstage(['b.txt'])

    const status = await git.status()
    expect(status.files[0]).toMatchObject({ path: 'b.txt', unstaged: 'untracked' })
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('b\n')
  })

  it('creates and lists branches, marking the current one', async () => {
    await git.checkout('feature/x', { create: true })
    const branches = await git.branches()

    expect(branches.find((b) => b.name === 'feature/x')?.current).toBe(true)
    expect(branches.find((b) => b.name === 'main')?.current).toBe(false)
  })

  it('surfaces git stderr rather than inventing a message', async () => {
    await expect(git.checkout('does-not-exist', {})).rejects.toThrow(/does-not-exist/)
  })

  it('reads the log newest first', async () => {
    await fs.writeFile(path.join(dir, 'c.txt'), 'c\n')
    await git.stage(['c.txt'])
    await git.commit('second', {})

    const log = await git.log({})
    expect(log.map((e) => e.subject)).toEqual(['second', 'initial'])
    expect(log[0].author).toBe('Test')
    expect(new Date(log[0].date).getTime()).toBeGreaterThan(0)
  })
})
