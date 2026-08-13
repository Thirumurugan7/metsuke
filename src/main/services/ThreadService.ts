import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  MergePreview,
  NewThreadOptions,
  Thread,
  TerminalSpawnOptions,
  TerminalSession
} from '@shared/ipc'
import { GitService } from './GitService'

/** Shared empty result, so the refresh path allocates nothing in the common case. */
const NO_CHANGES = { added: 0, removed: 0 } as const

/**
 * Everything this service needs from the rest of the app, injected so it stays free of
 * Electron and testable against a temp directory.
 */
export interface ThreadDeps {
  spawnTerminal: (opts: TerminalSpawnOptions) => TerminalSession
  writeTerminal: (id: string, data: string) => void
  killTerminal: (id: string) => void
  /** Git for the open folder, or null when it is not a repository. */
  git: () => GitService | null
  workspaceRoot: () => string | null
  onChange: (threads: Thread[]) => void
}

/** Where isolated checkouts live, relative to the open folder. */
const WORKTREE_DIR = path.join('.open-claude', 'worktrees')

/**
 * Turn a title into something git will accept as a branch name.
 *
 * Git rejects a surprising amount: leading dots and dashes, '..', '~^:?*[', trailing
 * '.lock', and consecutive slashes. Reducing to lowercase alphanumerics and single
 * dashes sidesteps all of it.
 */
export function branchSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug || `thread-${Date.now().toString(36)}`
}

/**
 * Threads: the unit of work the sidebar shows, in either of the two shapes Claude
 * actually runs in.
 *
 * An **instance** is a whole `claude` process on its own pty, optionally in its own git
 * worktree so it cannot touch anybody else's files. A **subagent** runs inside an
 * instance through Claude's own Task tool.
 *
 * Subagents are discovered rather than launched directly: the editor asks the parent to
 * delegate, and Claude Code's `PreToolUse`/`PostToolUse` hooks on the Task tool report
 * when one starts and stops. That means the sidebar tracks subagents the *agent* decides
 * to spawn on its own too, and it costs no terminal-stream parsing at all.
 */
export class ThreadService {
  readonly #threads = new Map<string, Thread>()
  readonly #deps: ThreadDeps
  /** Claude session id -> thread, learned from the first hook a session delivers. */
  readonly #bySession = new Map<string, string>()
  /** Threads picked up from a terminal rather than asked for. See `#isVestigial`. */
  readonly #adopted = new Set<string>()
  /** Serialises writes of the state file. See `#persist`. */
  #writes: Promise<void> = Promise.resolve()

  constructor(deps: ThreadDeps) {
    this.#deps = deps
  }

  list(): Thread[] {
    // Parents before their children, and within that, oldest first. The renderer relies
    // on this order to render the nesting without building a tree.
    const roots = [...this.#threads.values()]
      .filter((t) => t.parentId === null)
      .sort((a, b) => a.createdAt - b.createdAt)

    const out: Thread[] = []
    for (const root of roots) {
      out.push(root)
      out.push(
        ...[...this.#threads.values()]
          .filter((t) => t.parentId === root.id)
          .sort((a, b) => a.createdAt - b.createdAt)
      )
    }
    return out
  }

  #changed(): void {
    this.#deps.onChange(this.list())
    void this.#persist()
  }

  /**
   * Wait for pending writes to reach disk.
   *
   * Status changes persist in the background, since losing "running" to "idle" across a
   * crash costs nothing. Creating and closing a thread do not get that latitude: those
   * are the moments the list would be wrong in a way the user would notice, so those
   * paths await this before returning.
   */
  async flush(): Promise<void> {
    await this.#writes
  }

  // -------------------------------------------------------------------------
  // Surviving a restart
  // -------------------------------------------------------------------------

  /**
   * Where the thread list is kept between runs, inside the folder it describes.
   *
   * It belongs to the project rather than to the app, because that is what it is about:
   * these threads name branches and checkouts in this repository and mean nothing
   * anywhere else. It also sits under the same `.open-claude/` directory the worktrees
   * do, which is already excluded from git, so persisting costs the user nothing.
   */
  #stateFile(root: string): string {
    return path.join(root, '.open-claude', 'threads.json')
  }

  /**
   * Write the threads worth restoring.
   *
   * Only instances with their own worktree qualify. A thread sharing the workspace is
   * just a terminal that has since died, and a subagent lived inside a process that no
   * longer exists, so restoring either would put a row on screen with nothing behind it.
   * A worktree, by contrast, is still on disk with the work still in it.
   */
  #persist(): Promise<void> {
    // Chained rather than concurrent: two writes racing over one file can interleave and
    // leave truncated JSON, which on the next launch reads as "no threads at all".
    this.#writes = this.#writes.then(() => this.#writeState()).catch(() => {})
    return this.#writes
  }

  async #writeState(): Promise<void> {
    const root = this.#deps.workspaceRoot()
    if (!root) return

    const keep = [...this.#threads.values()].filter((t) => t.mode === 'instance' && t.worktree)

    try {
      const file = this.#stateFile(root)
      if (keep.length === 0) {
        // Leaving a stale file behind would resurrect threads the user has finished with.
        await fs.rm(file, { force: true })
        return
      }
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, `${JSON.stringify(keep, null, 2)}\n`)
    } catch {
      // Losing the list across a restart is a nuisance; failing the operation that
      // triggered the write would be worse.
    }
  }

  /**
   * Bring back the threads from a previous run of the app.
   *
   * Their processes are gone: ptys die with the main process, and no amount of
   * bookkeeping brings a conversation back. What survives is the part that matters after
   * the fact, the branch and the checkout, so a restored thread comes back finished
   * rather than pretending to be alive. From there it can be landed or closed, which is
   * exactly what the list was previously unable to offer.
   *
   * A thread whose worktree has since been deleted is dropped rather than shown, because
   * a row that cannot be landed or inspected is only a puzzle.
   */
  async restore(): Promise<void> {
    const root = this.#deps.workspaceRoot()
    if (!root) return

    let saved: Thread[]
    try {
      saved = JSON.parse(await fs.readFile(this.#stateFile(root), 'utf8')) as Thread[]
      if (!Array.isArray(saved)) return
    } catch {
      // No file, or unreadable. Either way there is nothing to restore.
      return
    }

    let restored = false
    for (const thread of saved) {
      if (!thread?.id || !thread.worktree || this.#threads.has(thread.id)) continue
      // Gone from disk means the work is gone with it.
      if (!(await fs.stat(thread.worktree).catch(() => null))) continue

      this.#threads.set(thread.id, {
        ...thread,
        terminalId: null,
        sessionId: null,
        status: thread.status === 'failed' ? 'failed' : 'done',
        detail: 'from an earlier session',
        endedAt: thread.endedAt ?? Date.now()
      })
      restored = true
    }

    if (restored) this.#changed()
  }

  #patch(id: string, patch: Partial<Thread>): void {
    const thread = this.#threads.get(id)
    if (!thread) return
    Object.assign(thread, patch)
    this.#changed()
  }

  // -------------------------------------------------------------------------
  // Creating
  // -------------------------------------------------------------------------

  async create(opts: NewThreadOptions): Promise<Thread> {
    return opts.mode === 'subagent' ? this.#createSubagent(opts) : this.#createInstance(opts)
  }

  async #createInstance(opts: NewThreadOptions): Promise<Thread> {
    const root = this.#deps.workspaceRoot()
    if (!root) throw new Error('Open a folder before starting a thread')

    let cwd = root
    let branch: string | null = null
    let worktree: string | null = null

    if (opts.worktree) {
      const git = this.#deps.git()
      if (!git) throw new Error('This folder is not a git repository, so it cannot use worktrees')

      branch = opts.branch?.trim() || branchSlug(opts.title)
      const dir = path.join(root, WORKTREE_DIR, branch)

      await this.#excludeWorktreeDir(root)
      worktree = await git.worktreeAdd(branch, dir)
      cwd = worktree
    }

    const session = this.#deps.spawnTerminal({
      command: 'claude',
      cwd,
      kind: 'claude',
      title: opts.title
    })

    const thread: Thread = {
      id: randomUUID(),
      title: opts.title,
      mode: 'instance',
      status: 'idle',
      parentId: null,
      terminalId: session.id,
      cwd,
      branch,
      worktree,
      sessionId: null,
      agentType: null,
      detail: worktree ? 'own worktree' : 'shares the workspace',
      added: 0,
      removed: 0,
      createdAt: Date.now(),
      endedAt: null
    }
    this.#threads.set(thread.id, thread)
    this.#changed()
    // A thread with a worktree must be on disk before this returns: it is the record
    // that the checkout and branch belong to something.
    await this.flush()

    /*
     * The pty needs a moment to get `claude` up and reading stdin. Typing into it before
     * the TUI is listening drops the text on the floor, which reads as the prompt being
     * ignored.
     */
    if (opts.prompt?.trim()) {
      const prompt = opts.prompt.trim()
      setTimeout(() => {
        this.#deps.writeTerminal(session.id, `${prompt}\r`)
        this.#patch(thread.id, { status: 'running' })
      }, 2500)
    }

    return thread
  }

  /**
   * A worktree inside the opened folder would otherwise show up as a pile of untracked
   * files in the git panel. `.git/info/exclude` is the right place for this: it is
   * per-clone and untracked, so the user's own `.gitignore` is never touched.
   */
  async #excludeWorktreeDir(root: string): Promise<void> {
    const excludePath = path.join(root, '.git', 'info', 'exclude')
    const line = '/.open-claude/'
    try {
      const current = await fs.readFile(excludePath, 'utf8').catch(() => '')
      if (current.split('\n').some((l) => l.trim() === line)) return
      await fs.mkdir(path.dirname(excludePath), { recursive: true })
      await fs.writeFile(excludePath, `${current}${current.endsWith('\n') || !current ? '' : '\n'}${line}\n`)
    } catch {
      // A worktree that shows up as untracked is untidy, not broken. Never block on it.
    }
  }

  /**
   * Ask an instance to delegate. There is no way to start a subagent from outside the
   * conversation, so this types the request into the parent exactly as the user would,
   * and the Task hooks then report the real thing back.
   */
  async #createSubagent(opts: NewThreadOptions): Promise<Thread> {
    const parent = opts.parentId
      ? this.#threads.get(opts.parentId)
      : this.#mostRecentInstance()

    if (!parent || parent.mode !== 'instance') {
      throw new Error('A subagent needs a running instance thread to live in')
    }
    if (!parent.terminalId) throw new Error('That thread has no live session')

    const thread: Thread = {
      id: randomUUID(),
      title: opts.title,
      mode: 'subagent',
      status: 'running',
      parentId: parent.id,
      terminalId: null,
      cwd: parent.cwd,
      branch: null,
      worktree: null,
      sessionId: parent.sessionId,
      agentType: 'general-purpose',
      detail: 'asked, waiting for it to start',
      added: 0,
      removed: 0,
      createdAt: Date.now(),
      endedAt: null
    }
    this.#threads.set(thread.id, thread)
    this.#changed()

    const isolation = opts.worktree ? ' Use isolation "worktree".' : ''
    const body = opts.prompt?.trim() || opts.title
    this.#deps.writeTerminal(
      parent.terminalId,
      `Use the Task tool to run this as a subagent with description "${opts.title}".${isolation} ${body}\r`
    )
    this.#patch(parent.id, { status: 'running' })

    return thread
  }

  #mostRecentInstance(): Thread | undefined {
    return [...this.#threads.values()]
      .filter((t) => t.mode === 'instance' && t.endedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
  }

  // -------------------------------------------------------------------------
  // Adopting terminals the user opened without going through the sheet
  // -------------------------------------------------------------------------

  /**
   * Every `claude` terminal is a thread whether or not it was started from the sheet,
   * because otherwise the list silently disagrees with the terminal tabs.
   */
  adoptTerminal(session: TerminalSession): Thread | null {
    if (session.kind !== 'claude') return null
    if ([...this.#threads.values()].some((t) => t.terminalId === session.id)) return null

    const thread: Thread = {
      id: randomUUID(),
      title: session.title || 'claude',
      mode: 'instance',
      status: 'idle',
      parentId: null,
      terminalId: session.id,
      cwd: session.cwd,
      branch: null,
      worktree: null,
      sessionId: null,
      agentType: null,
      detail: 'shares the workspace',
      added: 0,
      removed: 0,
      createdAt: Date.now(),
      endedAt: null
    }
    this.#threads.set(thread.id, thread)
    this.#adopted.add(thread.id)
    this.#changed()
    return thread
  }

  /** A pty died, so its thread is over one way or the other. */
  onTerminalExit(terminalId: string, exitCode: number): void {
    const thread = [...this.#threads.values()].find((t) => t.terminalId === terminalId)
    if (!thread) return

    // Its subagents cannot outlive the process they were running inside.
    for (const child of this.#threads.values()) {
      if (child.parentId === thread.id && child.endedAt === null) {
        Object.assign(child, { status: 'done', endedAt: Date.now(), detail: 'parent ended' })
      }
    }

    if (this.#isVestigial(thread)) {
      this.#threads.delete(thread.id)
      this.#adopted.delete(thread.id)
      this.#changed()
      return
    }

    Object.assign(thread, {
      status: exitCode === 0 ? 'done' : 'failed',
      detail: exitCode === 0 ? 'session ended' : `exited ${exitCode}`,
      terminalId: null,
      endedAt: Date.now()
    })
    this.#changed()
  }

  /**
   * Whether a dead thread is worth keeping a row for.
   *
   * StrictMode double-invokes the mount effect that opens the first terminal, so the
   * renderer spawns two ptys and kills the one it discards. Both get adopted, and
   * without this every launch of the app leaves a permanent "session ended" row for a
   * process that never existed as far as the user is concerned.
   *
   * The test is what the thread left behind, not how it died: no session id means it
   * never became a conversation there is anything to reattach to, and no branch means
   * it produced no commits to go back for. Only adopted threads qualify - one the user
   * named in the sheet is theirs, and deleting it under them would be worse than a
   * stale row, however little it managed to do.
   */
  #isVestigial(thread: Thread): boolean {
    return this.#adopted.has(thread.id) && thread.sessionId === null && thread.branch === null
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  /**
   * Fold a Claude Code hook delivery into the thread list.
   *
   * Payload shapes vary by event and across CLI versions, so everything here is read
   * defensively: a field that is missing costs a label, never an exception, and an
   * unrecognised kind is ignored rather than guessed at.
   */
  ingestHook(kind: string, payload: Record<string, unknown>): void {
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
    const thread = this.#resolveThread(sessionId, cwd)
    if (!thread) return

    switch (kind) {
      case 'prompt':
        this.#patch(thread.id, { status: 'running', detail: 'working' })
        break

      case 'notification': {
        const message = typeof payload.message === 'string' ? payload.message : ''
        const permission = /permission|approve|allow|confirm|authorize|authorise/i.test(message)
        this.#patch(thread.id, {
          status: 'waiting',
          detail: permission ? 'needs permission' : 'waiting on you'
        })
        break
      }

      case 'stop':
        this.#patch(thread.id, { status: 'idle', detail: 'finished its turn' })
        break

      case 'subagent-start':
        this.#subagentStarted(thread, payload)
        break

      case 'subagent-stop':
        this.#subagentStopped(thread, payload)
        break
    }
  }

  /**
   * Which thread a hook belongs to.
   *
   * Session id is authoritative once seen. Before that, the only clue is the working
   * directory, which is unique per thread when threads use worktrees and shared by all
   * of them when they do not. In the shared case the newest instance without a session
   * yet is the best available guess, and it is right in the common flow of starting a
   * thread and immediately using it.
   */
  #resolveThread(sessionId: string | null, cwd: string | null): Thread | undefined {
    if (sessionId) {
      const known = this.#bySession.get(sessionId)
      if (known) return this.#threads.get(known)
    }

    const candidates = [...this.#threads.values()].filter(
      (t) => t.mode === 'instance' && t.endedAt === null && t.sessionId === null
    )
    const byCwd = cwd
      ? candidates.find((t) => path.resolve(t.cwd) === path.resolve(cwd))
      : undefined
    const match = byCwd ?? candidates.sort((a, b) => b.createdAt - a.createdAt)[0]

    if (match && sessionId) {
      match.sessionId = sessionId
      this.#bySession.set(sessionId, match.id)
    }
    return match
  }

  /** A `Task` call started. Attach it to the subagent row the user asked for, or add one. */
  #subagentStarted(parent: Thread, payload: Record<string, unknown>): void {
    const input = (payload.tool_input ?? {}) as Record<string, unknown>
    const description = typeof input.description === 'string' ? input.description : 'subagent'
    const agentType = typeof input.subagent_type === 'string' ? input.subagent_type : null

    // The sheet creates the row before Claude runs the tool, so prefer adopting that one
    // over adding a duplicate beside it.
    const pending = [...this.#threads.values()].find(
      (t) =>
        t.parentId === parent.id &&
        t.mode === 'subagent' &&
        t.endedAt === null &&
        (t.title === description || t.detail === 'asked, waiting for it to start')
    )

    if (pending) {
      Object.assign(pending, {
        title: description,
        agentType: agentType ?? pending.agentType,
        status: 'running',
        detail: agentType ? `${agentType} · running` : 'running'
      })
    } else {
      const id = randomUUID()
      this.#threads.set(id, {
        id,
        title: description,
        mode: 'subagent',
        status: 'running',
        parentId: parent.id,
        terminalId: null,
        cwd: parent.cwd,
        branch: null,
        worktree: null,
        sessionId: parent.sessionId,
        agentType,
        detail: agentType ? `${agentType} · running` : 'running',
        added: 0,
        removed: 0,
        createdAt: Date.now(),
        endedAt: null
      })
    }
    this.#changed()
  }

  #subagentStopped(parent: Thread, payload: Record<string, unknown>): void {
    const input = (payload.tool_input ?? {}) as Record<string, unknown>
    const description = typeof input.description === 'string' ? input.description : null

    const running = [...this.#threads.values()].filter(
      (t) => t.parentId === parent.id && t.mode === 'subagent' && t.endedAt === null
    )
    // Several can be in flight at once, so match the description when there is one and
    // fall back to the oldest, which is the one most likely to have finished.
    const done =
      (description && running.find((t) => t.title === description)) ??
      running.sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!done) return

    Object.assign(done, {
      status: 'done',
      endedAt: Date.now(),
      detail: this.#reportSize(payload) ?? 'returned a summary'
    })
    this.#changed()
  }

  /** How much came back, which is the honest measure of what a subagent cost the parent. */
  #reportSize(payload: Record<string, unknown>): string | null {
    const response = payload.tool_response
    const text =
      typeof response === 'string'
        ? response
        : response && typeof response === 'object'
          ? JSON.stringify(response)
          : null
    if (!text) return null
    // Four characters to the token is the usual rule of thumb and close enough for a label.
    return `returned about ${Math.max(1, Math.round(text.length / 4))} tok`
  }

  // -------------------------------------------------------------------------
  // Landing
  // -------------------------------------------------------------------------

  /** What landing this thread would do. Computes nothing destructive. */
  async mergePreview(id: string): Promise<MergePreview> {
    const { git, thread } = this.#landable(id)
    return git.mergePreview(thread.branch!)
  }

  /**
   * Land a thread: merge its branch into whatever the workspace has checked out, then
   * close it.
   *
   * The order matters. The worktree is removed only after the merge succeeds, because a
   * failed merge leaves the work exactly where it was and the thread still usable. A
   * conflict aborts inside GitService and throws, so nothing here has to unwind.
   *
   * The branch outlives the merge unless asked otherwise, since it is the record of what
   * the thread did and deleting it is not something to do on the user's behalf.
   */
  async merge(id: string, opts: { message?: string; deleteBranch?: boolean } = {}): Promise<void> {
    const { git, thread } = this.#landable(id)
    const branch = thread.branch!

    const preview = await git.mergePreview(branch)
    if (preview.alreadyMerged) {
      // Nothing to merge is not a failure; the thread is simply finished.
      await this.close(id, { removeWorktree: true })
      return
    }

    await git.merge(branch, { message: opts.message ?? `Merge thread: ${thread.title}` })

    // Only now is the checkout expendable. Removing it first would strand the work if
    // the merge then failed.
    await this.close(id, { removeWorktree: true })

    if (opts.deleteBranch) {
      // The commits are in the base branch now, so a plain -d will accept it.
      await git.deleteBranch(branch).catch(() => {})
    }
  }

  /**
   * The checks both landing paths share.
   *
   * A thread without a branch has nothing to land, and one whose worktree is the folder
   * the user is looking at would be merging a branch into itself.
   */
  #landable(id: string): { git: GitService; thread: Thread } {
    const thread = this.#threads.get(id)
    if (!thread) throw new Error('That thread no longer exists')
    if (!thread.branch) {
      throw new Error('This thread shares the workspace, so it has no branch to land')
    }

    const git = this.#deps.git()
    if (!git) throw new Error('This folder is not a git repository')

    return { git, thread }
  }

  // -------------------------------------------------------------------------
  // Closing and refreshing
  // -------------------------------------------------------------------------

  async close(id: string, opts: { removeWorktree?: boolean } = {}): Promise<void> {
    const thread = this.#threads.get(id)
    if (!thread) return

    if (thread.terminalId) this.#deps.killTerminal(thread.terminalId)

    if (opts.removeWorktree && thread.worktree) {
      const git = this.#deps.git()
      // The branch survives either way; only the checkout goes. If git refuses, the
      // thread still closes, because leaving a dead row in the list is worse.
      if (git) await git.worktreeRemove(thread.worktree).catch(() => {})
    }

    for (const child of [...this.#threads.values()]) {
      if (child.parentId === id) this.#threads.delete(child.id)
    }
    this.#threads.delete(id)
    this.#adopted.delete(id)
    if (thread.sessionId) this.#bySession.delete(thread.sessionId)
    this.#changed()
    // Closing has to stick too, or a restart resurrects a thread the user finished with.
    await this.flush()
  }

  /** Recompute what each thread has actually changed. */
  async refresh(): Promise<Thread[]> {
    const git = this.#deps.git()
    if (!git) return this.list()

    // The branch every worktree measures against. Falls back to HEAD when the repo has
    // no main or master, which is normal in a fresh one.
    const base = await this.#baseBranch(git)

    for (const thread of this.#threads.values()) {
      if (thread.mode !== 'instance' || !thread.branch) continue
      try {
        const committed = await git.branchStat(thread.branch, base)

        /*
         * Committed lines alone under-report badly. An agent that has been editing for
         * ten minutes and has not committed yet would show +0, which reads as a thread
         * that has done nothing. The two ranges do not overlap - one is base..branch,
         * the other is HEAD..working tree - so they add.
         *
         * Only a thread with its own worktree can be measured this way. One sharing the
         * workspace has no separate working tree to attribute the edits to.
         */
        const dirty = thread.worktree
          ? await new GitService(thread.worktree).dirtyStat().catch(() => NO_CHANGES)
          : NO_CHANGES

        Object.assign(thread, {
          added: committed.added + dirty.added,
          removed: committed.removed + dirty.removed
        })
      } catch {
        // A branch with no merge base yet reports nothing rather than breaking the list.
      }
    }
    this.#changed()
    return this.list()
  }

  async #baseBranch(git: GitService): Promise<string> {
    const branches = await git.branches().catch(() => [])
    const names = new Set(branches.filter((b) => !b.remote).map((b) => b.name))
    if (names.has('main')) return 'main'
    if (names.has('master')) return 'master'
    return 'HEAD'
  }

  /** Drop every thread, for when the open folder changes. Terminals are killed elsewhere. */
  clear(): void {
    this.#threads.clear()
    this.#bySession.clear()
    this.#adopted.clear()

    /*
     * Deliberately not #changed(): this must not persist. Clearing happens while
     * switching project, by which point the workspace root already points at the NEW
     * folder, so writing an empty list here would delete the incoming project's saved
     * threads before they were ever restored. Forgetting them in memory is the whole
     * job; the file belongs to whichever project owns it.
     */
    this.#deps.onChange(this.list())
  }
}
