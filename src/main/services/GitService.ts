import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  DiffKind,
  GitBranch,
  GitDiff,
  GitFileChange,
  GitFileStatus,
  GitLogEntry,
  GitStatus,
  MergePreview
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
      // The null device differs by platform, and `--no-index` hands the path to the
      // filesystem rather than resolving it through git's MSYS layer.
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      patch = await this.#gitTolerant([
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-index',
        '--',
        nullDevice,
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

  /** Updates remote-tracking branches without touching the working tree. */
  async fetch(): Promise<string> {
    return this.#git(['fetch'])
  }

  /** Shelves every uncommitted change, staged and unstaged, and restores a clean tree. */
  async stash(message?: string): Promise<string> {
    const args = ['stash', 'push']
    if (message?.trim()) args.push('-m', message.trim())
    return this.#git(args)
  }

  // -------------------------------------------------------------------------
  // Landing work
  // -------------------------------------------------------------------------

  /**
   * What merging `branch` into the current one would do, without doing it.
   *
   * A thread's whole output is a branch, and the question you actually have before
   * landing it is "will this conflict, and with what". Asking git that directly beats
   * merging and then reaching for the undo: `merge-tree` computes the result in memory
   * and touches neither the index nor the working tree, so this is safe to call while
   * an agent is still writing files.
   */
  async mergePreview(branch: string): Promise<MergePreview> {
    const base = (await this.#git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

    // Nothing to do is a real answer, and a distinct one from a clean merge.
    const ahead = (await this.#gitTolerant(['rev-list', '--count', `${base}..${branch}`])).trim()
    if (ahead === '0') {
      return { base, branch, commits: 0, conflicts: [], alreadyMerged: true, ...NO_CHANGES }
    }

    const stat = await this.branchStat(branch, base)

    /*
     * `merge-tree --write-tree` reports conflicts on stdout and exits non-zero when it
     * finds them, which is a result rather than a failure. Older git lacks this form,
     * and rather than silently claiming a clean merge, an unusable answer is reported
     * as unknown so the UI can say so.
     */
    let conflicts: string[] = []
    let known = true
    try {
      const raw = await this.#gitTolerant([
        'merge-tree',
        '--write-tree',
        '--name-only',
        base,
        branch
      ])
      conflicts = parseMergeTreeConflicts(raw)
    } catch {
      known = false
    }

    return {
      base,
      branch,
      commits: Number(ahead) || 0,
      conflicts,
      conflictsKnown: known,
      alreadyMerged: false,
      added: stat.added,
      removed: stat.removed
    }
  }

  /**
   * Merge `branch` into the current branch.
   *
   * `--no-ff` on purpose: a thread is a unit of work and the merge commit is the record
   * that it happened. Fast-forwarding would scatter its commits into the base branch's
   * history with nothing tying them together.
   *
   * On conflict git leaves the merge in progress, which is a state the user has to
   * resolve in the working tree, so it aborts and says so rather than leaving the
   * repository half-merged behind a UI that has moved on.
   */
  async merge(branch: string, opts: { message?: string } = {}): Promise<void> {
    const message = opts.message?.trim() || `Merge ${branch}`
    try {
      await this.#git(['merge', '--no-ff', '-m', message, branch])
    } catch (e) {
      if (e instanceof GitError) {
        await this.#gitTolerant(['merge', '--abort']).catch(() => {})
        throw new GitError(
          `${e.stderr || e.message}\n\nThe merge was undone, so the working tree is as it was.`,
          e.stderr,
          e.stdout
        )
      }
      throw e
    }
  }

  /** Delete a branch once its work has landed. Refuses if it has not, unless forced. */
  async deleteBranch(branch: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.#git(['branch', opts.force ? '-D' : '-d', branch])
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

  // -------------------------------------------------------------------------
  // Worktrees
  // -------------------------------------------------------------------------

  /**
   * A second checkout of the same repository, on its own branch.
   *
   * This is what lets two agents work at once without overwriting each other. They
   * share one `.git` object store, so a worktree costs the working files and nothing
   * else, and a branch created in one is immediately visible from the other.
   *
   * Returns the absolute path of the new checkout.
   */
  async worktreeAdd(branch: string, dir: string, opts: { from?: string } = {}): Promise<string> {
    const target = path.resolve(dir)

    /*
     * `-B` resets an existing branch to the start point, which would silently throw
     * away commits from an earlier thread on the same name. Check first and reuse the
     * branch instead, so re-opening a thread picks up where it left off.
     */
    const exists = await this.#branchExists(branch)
    const args = exists
      ? ['worktree', 'add', target, branch]
      : ['worktree', 'add', '-b', branch, target, opts.from ?? 'HEAD']

    await this.#git(args)
    return target
  }

  async #branchExists(branch: string): Promise<boolean> {
    try {
      await this.#git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
      return true
    } catch {
      return false
    }
  }

  /**
   * Detach a worktree. The branch and its commits survive: they are the output of the
   * thread, and deleting them along with the directory would throw away the work.
   *
   * `--force` because a thread that ends mid-edit leaves the checkout dirty, and
   * refusing to clean up then would strand the directory forever.
   */
  async worktreeRemove(dir: string): Promise<void> {
    await this.#git(['worktree', 'remove', '--force', path.resolve(dir)])
  }

  /** Every checkout of this repository, the main one included. */
  async worktrees(): Promise<Array<{ path: string; branch: string | null; detached: boolean }>> {
    const raw = await this.#git(['worktree', 'list', '--porcelain'])
    const out: Array<{ path: string; branch: string | null; detached: boolean }> = []

    // Records are separated by a blank line; each is `key value` or a bare keyword.
    for (const record of raw.split(/\n\n+/)) {
      const lines = record.split('\n').filter(Boolean)
      if (lines.length === 0) continue

      const worktree = lines.find((l) => l.startsWith('worktree '))?.slice(9)
      if (!worktree) continue

      const head = lines.find((l) => l.startsWith('branch '))?.slice(7)
      out.push({
        path: worktree,
        branch: head ? head.replace(/^refs\/heads\//, '') : null,
        detached: lines.includes('detached')
      })
    }
    return out
  }

  /**
   * Lines added and removed on `branch` since it left `base`, working tree included.
   *
   * The three-dot range measures against the merge base rather than the tip of `base`,
   * so the count does not grow every time somebody else commits to main.
   */
  async branchStat(branch: string, base: string): Promise<{ added: number; removed: number }> {
    try {
      return parseNumstat(await this.#gitTolerant(['diff', '--numstat', `${base}...${branch}`]))
    } catch (e) {
      /*
       * Unrelated histories have no merge base, so git cannot resolve the three-dot
       * range and fails with nothing on stdout. That is a real state for a repository
       * to be in, not a fault, and the honest answer for a sidebar is that the size of
       * the difference is unknown. Anything else still throws.
       */
      if (e instanceof GitError && /no merge base/i.test(e.stderr)) return { added: 0, removed: 0 }
      throw e
    }
  }

  /**
   * Uncommitted lines in a checkout. A thread that has not committed yet still has
   * work to show, and a sidebar that reads 0 while files are open is just wrong.
   *
   * Untracked files are counted too. `git diff` cannot see them at all, and an agent's
   * first act is very often to write a new file, so leaving them out would report
   * nothing for exactly the case this exists to cover. Counting them without staging
   * them matters: `add -N` would mutate an index the user is also using.
   */
  async dirtyStat(): Promise<{ added: number; removed: number }> {
    const tracked = parseNumstat(await this.#gitTolerant(['diff', '--numstat', 'HEAD']))
    const untracked = await this.#untrackedLines()
    return { added: tracked.added + untracked, removed: tracked.removed }
  }

  /**
   * Lines in files git is not tracking yet.
   *
   * Bounded on both axes, because this runs on a timer against a directory an agent is
   * actively writing to: a build output that escaped .gitignore should cost a wrong
   * number in a sidebar, never a stalled refresh.
   */
  async #untrackedLines(): Promise<number> {
    const MAX_FILES = 500
    const MAX_BYTES = 1024 * 1024

    const raw = await this.#gitTolerant(['ls-files', '--others', '--exclude-standard', '-z'])
    const files = raw.split('\0').filter(Boolean).slice(0, MAX_FILES)

    let added = 0
    for (const file of files) {
      try {
        const full = path.resolve(this.cwd, file)
        const { size } = await fs.stat(full)
        if (size > MAX_BYTES) continue

        const text = await fs.readFile(full, 'utf8')
        // A NUL byte means binary, which has no lines worth reporting.
        if (text.includes('\0')) continue
        if (text.length === 0) continue
        // A trailing newline terminates the last line rather than starting a new one.
        added += text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
      } catch {
        // Vanished mid-scan, or unreadable. Either way it is not worth a number.
      }
    }
    return added
  }
}

/** Shared empty diff result, so the merge preview allocates nothing for the no-op case. */
const NO_CHANGES = { added: 0, removed: 0 } as const

/**
 * Pull the conflicted paths out of `git merge-tree --write-tree --name-only`.
 *
 * The output is the resulting tree's object id on the first line, then, when the merge
 * does not apply cleanly, an "Auto-merging"/"CONFLICT" informational block. With
 * --name-only the conflicted paths are listed one per line after a blank line. Anything
 * that does not look like a path is ignored rather than guessed at, because a wrong
 * conflict list is worse than an empty one: it would stop a user landing work that would
 * have merged fine.
 */
function parseMergeTreeConflicts(raw: string): string[] {
  const [, ...rest] = raw.split('\n')
  return rest
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('Auto-merging'))
    .filter((line, index, all) => all.indexOf(line) === index)
}

/**
 * Sum `git diff --numstat` output.
 *
 * Every line is `added\tremoved\tpath`, and a binary file reports '-' for both because
 * it has no lines to count.
 */
function parseNumstat(raw: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of raw.split('\n')) {
    const [a, r] = line.split('\t')
    if (a && a !== '-') added += Number(a) || 0
    if (r && r !== '-') removed += Number(r) || 0
  }
  return { added, removed }
}
