import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type {
  DiffKind,
  GitBranch,
  GitDiff,
  GitFileChange,
  GitFileStatus,
  GitLogEntry,
  GitStatus
} from '@shared/ipc'

const exec = promisify(execFile)

/** Porcelain v2 status letters, for both the staged and unstaged column. */
const STATUS_LETTERS: Record<string, GitFileStatus> = {
  '.': 'unchanged',
  M: 'modified',
  T: 'modified', // typechange; the UI has no separate affordance for it
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted'
}

export class GitError extends Error {
  /** git's stderr, verbatim. Surfaced to the user unedited. */
  readonly stderr: string
  /** Whatever git managed to write before failing; some commands signal via exit code. */
  readonly stdout: string
  constructor(message: string, stderr: string, stdout = '') {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
    this.stdout = stdout
  }
}

/**
 * A git client for one repository, implemented by shelling out to the `git` binary.
 *
 * Using the real CLI rather than a reimplementation means credential helpers, hooks,
 * SSH config, signing, and worktrees all behave exactly as they do in the user's
 * terminal. Every failure carries git's own stderr so the UI never invents a message.
 */
export class GitService {
  readonly cwd: string

  constructor(cwd: string) {
    this.cwd = path.resolve(cwd)
  }

  /** Run a git command, rejecting with the process's own stderr on failure. */
  async #git(args: string[]): Promise<string> {
    try {
      const { stdout } = await exec('git', args, {
        cwd: this.cwd,
        maxBuffer: 64 * 1024 * 1024,
        // Stable, parseable output regardless of the user's config or locale.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      })
      return stdout
    } catch (e) {
      const error = e as { stderr?: string; stdout?: string; message: string }
      const stderr = (error.stderr ?? '').trim()
      throw new GitError(stderr || error.message, stderr, error.stdout ?? '')
    }
  }

  /**
   * Run a git command that signals its result through the exit code rather than
   * through failure — `diff --no-index` exits 1 when the files differ. Returns stdout
   * either way, and only throws when git could not run at all.
   */
  async #gitTolerant(args: string[]): Promise<string> {
    try {
      return await this.#git(args)
    } catch (e) {
      if (e instanceof GitError && e.stdout) return e.stdout
      throw e
    }
  }

  /** True when `cwd` is inside a git worktree. */
  static async isRepo(cwd: string): Promise<boolean> {
    try {
      await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
      return true
    } catch {
      return false
    }
  }

  /** Absolute path of the repository root, which may be above `cwd`. */
  async root(): Promise<string> {
    return (await this.#git(['rev-parse', '--show-toplevel'])).trim()
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Working tree status via `--porcelain=v2 -z`, which is the only status format that
   * is both machine-stable across git versions and unambiguous for paths containing
   * spaces, quotes, or newlines.
   */
  async status(): Promise<GitStatus> {
    const raw = await this.#git(['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'])
    return GitService.parseStatus(raw)
  }

  /** Exposed as a static so it can be unit-tested against captured git output. */
  static parseStatus(raw: string): GitStatus {
    const status: GitStatus = {
      branch: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: []
    }

    // -z gives NUL-terminated records. Rename/copy records (type 2) carry a second
    // NUL-separated field for the original path, so we consume fields with an index
    // rather than a plain for-of.
    const fields = raw.split('\0')

    for (let i = 0; i < fields.length; i++) {
      const line = fields[i]
      if (!line) continue

      if (line.startsWith('# branch.head ')) {
        const head = line.slice('# branch.head '.length)
        if (head === '(detached)') {
          status.detached = true
          status.branch = null
        } else {
          status.branch = head
        }
      } else if (line.startsWith('# branch.upstream ')) {
        status.upstream = line.slice('# branch.upstream '.length)
      } else if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(line)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      } else if (line.startsWith('1 ')) {
        // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
        const xy = line.slice(2, 4)
        const filePath = line.split(' ').slice(8).join(' ')
        status.files.push(GitService.#change(filePath, xy))
      } else if (line.startsWith('2 ')) {
        // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>, then NUL <origPath>
        const xy = line.slice(2, 4)
        const filePath = line.split(' ').slice(9).join(' ')
        const origPath = fields[++i] ?? undefined
        status.files.push({ ...GitService.#change(filePath, xy), origPath })
      } else if (line.startsWith('u ')) {
        // Unmerged. Both sides are conflicted regardless of the specific XY pair.
        const filePath = line.split(' ').slice(10).join(' ')
        status.files.push({ path: filePath, staged: 'conflicted', unstaged: 'conflicted' })
      } else if (line.startsWith('? ')) {
        status.files.push({ path: line.slice(2), staged: 'unchanged', unstaged: 'untracked' })
      } else if (line.startsWith('! ')) {
        status.files.push({ path: line.slice(2), staged: 'unchanged', unstaged: 'ignored' })
      }
    }

    status.files.sort((a, b) => a.path.localeCompare(b.path))
    return status
  }

  static #change(filePath: string, xy: string): GitFileChange {
    return {
      path: filePath,
      staged: STATUS_LETTERS[xy[0]] ?? 'unchanged',
      unstaged: STATUS_LETTERS[xy[1]] ?? 'unchanged'
    }
  }

  // -------------------------------------------------------------------------
  // Diffs
  // -------------------------------------------------------------------------

  /**
   * Unified diff for one file.
   *
   * - `worktree`: unstaged changes (worktree vs index)
   * - `staged`:   staged changes (index vs HEAD)
   * - `head`:     everything since HEAD (worktree vs HEAD)
   *
   * Untracked files have no diff to compute, so their full contents are rendered as
   * an all-additions patch — otherwise clicking a new file in the UI shows nothing.
   */
  async diff(filePath: string, kind: DiffKind): Promise<GitDiff> {
    const args = ['diff', '--no-color', '--no-ext-diff']
    if (kind === 'staged') args.push('--cached')
    else if (kind === 'head') args.push('HEAD')
    args.push('--', filePath)

    let patch = await this.#git(args)

    if (!patch.trim() && kind !== 'staged') {
      // Probably untracked, so `git diff` has nothing to say about it. Diffing against
      // /dev/null renders the whole file as additions. `--no-index` exits 1 whenever
      // the files differ, which is the expected case here, so tolerate the exit code.
      patch = await this.#gitTolerant([
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-index',
        '--',
        '/dev/null',
        filePath
      ])
    }

    return {
      path: filePath,
      kind,
      patch,
      binary: /^Binary files .* differ$/m.test(patch)
    }
  }

  // -------------------------------------------------------------------------
  // Index
  // -------------------------------------------------------------------------

  async stage(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    // -A so deletions are staged too, not just modifications and additions.
    await this.#git(['add', '-A', '--', ...paths])
  }

  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.#git(['restore', '--staged', '--', ...paths])
  }

  /** Throw away worktree changes. Destructive and unrecoverable — the UI confirms first. */
  async discard(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.#git(['restore', '--worktree', '--', ...paths])
  }

  /** Commit the index. Returns the new commit's short hash. */
  async commit(message: string, opts: { amend?: boolean } = {}): Promise<string> {
    if (!message.trim() && !opts.amend) throw new GitError('Commit message is empty', '')
    const args = ['commit', '-m', message]
    if (opts.amend) args.push('--amend')
    await this.#git(args)
    return (await this.#git(['rev-parse', '--short', 'HEAD'])).trim()
  }

  // -------------------------------------------------------------------------
  // Branches and remotes
  // -------------------------------------------------------------------------

  async branches(): Promise<GitBranch[]> {
    const raw = await this.#git([
      'for-each-ref',
      '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)',
      'refs/heads',
      'refs/remotes'
    ])

    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head, upstream] = line.split('\t')
        return {
          name,
          current: head === '*',
          remote: name.includes('/') && !name.startsWith('refs/heads'),
          upstream: upstream || null
        }
      })
      .filter((b) => b.name !== 'origin/HEAD')
  }

  async checkout(branch: string, opts: { create?: boolean } = {}): Promise<void> {
    await this.#git(opts.create ? ['checkout', '-b', branch] : ['checkout', branch])
  }

  /**
   * Push to the upstream. Git writes progress and the "set upstream" hint to stderr
   * even on success, so the caller gets stdout and stderr is only surfaced on failure.
   */
  async push(opts: { setUpstream?: boolean } = {}): Promise<string> {
    const args = ['push']
    if (opts.setUpstream) {
      const branch = (await this.#git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      args.push('--set-upstream', 'origin', branch)
    }
    return this.#git(args)
  }

  async pull(opts: { rebase?: boolean } = {}): Promise<string> {
    return this.#git(opts.rebase ? ['pull', '--rebase'] : ['pull'])
  }

  async log(opts: { limit?: number; path?: string } = {}): Promise<GitLogEntry[]> {
    const { limit = 100, path: filePath } = opts
    // Unit separator between fields, record separator between commits: neither can
    // appear in a commit subject, unlike the tabs and newlines that can.
    const args = ['log', `--max-count=${limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e']
    if (filePath) args.push('--', filePath)

    const raw = await this.#git(args)
    return raw
      .split('\x1e')
      .map((r) => r.replace(/^\n/, ''))
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, subject, author, date] = record.split('\x1f')
        return { hash, shortHash, subject, author, date }
      })
  }
}
