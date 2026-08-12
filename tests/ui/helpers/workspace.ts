import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)

/** Fixed content, so the explorer and search render identically every run. */
const TREE: Record<string, string> = {
  'README.md': '# Fixture\n\nA folder with known contents.\n',
  'src/app.ts': 'export function start(): string {\n  return "started"\n}\n',
  'src/util.ts': 'export const NAME = "fixture"\n',
  'docs/notes.md': '# Notes\n\nThe word haystack appears here.\n'
}

export async function makeWorkspace(): Promise<string> {
  /*
   * The folder's own name has to be identical every run, because the app puts it in the
   * title bar and the status bar. A bare mkdtemp gives a random suffix, which lands
   * straight in the pixels and fails the comparison on a difference that means nothing.
   * The random part stays on the parent, which is never displayed; the project folder
   * itself is always called "fixture".
   */
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'open-claude-ws-'))
  const dir = path.join(parent, 'fixture')
  await fs.mkdir(dir, { recursive: true })
  for (const [rel, body] of Object.entries(TREE)) {
    const full = path.join(dir, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, body)
  }
  return dir
}

/**
 * A workspace that is also a git repo.
 *
 * Author and committer dates are pinned, because the git log panel shows them and an
 * unpinned date changes the pixels on every run.
 */
export async function makeRepo(): Promise<string> {
  const dir = await makeWorkspace()
  const when = '2026-01-01T12:00:00Z'
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_EMAIL: 'fixture@example.com'
  }
  const run = (args: string[]) => exec('git', args, { cwd: dir, env })

  await run(['init', '-q', '-b', 'main'])
  await run(['config', 'commit.gpgsign', 'false'])
  await run(['add', '.'])
  await run(['commit', '-q', '-m', 'Add the fixture tree'])
  return dir
}

export async function removeDir(dir: string): Promise<void> {
  /*
   * Remove the random parent too, not just the "fixture" folder inside it, or every run
   * leaves an empty directory behind in the system temp area.
   */
  const parent = path.dirname(dir)
  const target = path.basename(parent).startsWith('open-claude-ws-') ? parent : dir
  await fs.rm(target, { recursive: true, force: true })
}
