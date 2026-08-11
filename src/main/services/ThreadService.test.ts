import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitService } from './GitService'
import { ThreadService, branchSlug, type ThreadDeps } from './ThreadService'
import type { TerminalSession, TerminalSpawnOptions, Thread } from '@shared/ipc'

const exec = promisify(execFile)

/**
 * The terminal layer, recorded rather than run.
 *
 * ThreadService only ever spawns, writes to and kills ptys, so a log of those three is
 * the whole contract, and the tests can assert on the exact text typed into a session.
 */
function fakeTerminals(): {
  deps: Pick<ThreadDeps, 'spawnTerminal' | 'writeTerminal' | 'killTerminal'>
  spawned: TerminalSpawnOptions[]
  writes: Array<{ id: string; data: string }>
  killed: string[]
} {
  const spawned: TerminalSpawnOptions[] = []
  const writes: Array<{ id: string; data: string }> = []
  const killed: string[] = []
  let n = 0

  return {
    spawned,
    writes,
    killed,
    deps: {
      spawnTerminal: (opts) => {
        spawned.push(opts)
        const session: TerminalSession = {
          id: `pty-${++n}`,
          command: opts.command ?? 'zsh',
          kind: opts.kind ?? 'shell',
          cwd: opts.cwd ?? '/tmp',
          title: opts.title ?? 'terminal'
        }
        return session
      },
      writeTerminal: (id, data) => writes.push({ id, data }),
      killTerminal: (id) => killed.push(id)
    }
  }
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-claude-thread-'))
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

describe('branchSlug', () => {
  it('reduces a title to something git will accept', () => {
    expect(branchSlug('Fix checkout 500 on empty cart')).toBe('fix-checkout-500-on-empty-cart')
  })

  it('strips the characters git rejects in a ref', () => {
    // Leading dots and dashes, '..', and '~^:?*[' are all refusals from git itself.
    expect(branchSlug('..~^:?*[ weird //name ')).toBe('weird-name')
  })

  it('never returns empty, because a branch still needs a name', () => {
    expect(branchSlug('***')).toMatch(/^thread-/)
  })

  it('caps the length so the directory name stays workable', () => {
    expect(branchSlug('a'.repeat(80)).length).toBeLessThanOrEqual(40)
  })

  it('does not leave a trailing dash after truncating mid-word', () => {
    expect(branchSlug(`${'a'.repeat(39)} tail`)).not.toMatch(/-$/)
  })
})

describe('ThreadService', () => {
  let dir: string
  let terminals: ReturnType<typeof fakeTerminals>
  let threads: ThreadService
  let changes: Thread[][]

  beforeEach(async () => {
    dir = await makeRepo()
    terminals = fakeTerminals()
    changes = []
    threads = new ThreadService({
      ...terminals.deps,
      git: () => new GitService(dir),
      workspaceRoot: () => dir,
      onChange: (list) => changes.push(list)
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(dir, { recursive: true, force: true })
  })

  // -- instances ------------------------------------------------------------

  it('starts an instance in the workspace when it is not given a worktree', async () => {
    const thread = await threads.create({ title: 'Look around', mode: 'instance', worktree: false })

    expect(thread).toMatchObject({ mode: 'instance', cwd: dir, branch: null, worktree: null })
    expect(terminals.spawned[0]).toMatchObject({ command: 'claude', cwd: dir, kind: 'claude' })
  })

  it('gives an instance its own checkout and branch when asked', async () => {
    const thread = await threads.create({
      title: 'Fix the cart bug',
      mode: 'instance',
      worktree: true
    })

    expect(thread.branch).toBe('fix-the-cart-bug')
    expect(thread.worktree).toBe(path.resolve(dir, '.open-claude/worktrees/fix-the-cart-bug'))
    // The session must start inside the worktree, or it would edit the user's files.
    expect(terminals.spawned[0].cwd).toBe(thread.worktree)
    expect(await fs.readFile(path.join(thread.worktree!, 'README.md'), 'utf8')).toBe('# hello\n')
  })

  it('honours an explicit branch name over the slug', async () => {
    const thread = await threads.create({
      title: 'Anything',
      mode: 'instance',
      worktree: true,
      branch: 'feature/explicit'
    })
    expect(thread.branch).toBe('feature/explicit')
  })

  it('hides its worktrees from the git panel without touching the user .gitignore', async () => {
    await threads.create({ title: 'One', mode: 'instance', worktree: true })

    const exclude = await fs.readFile(path.join(dir, '.git/info/exclude'), 'utf8')
    expect(exclude).toMatch(/^\/\.open-claude\/$/m)
    await expect(fs.stat(path.join(dir, '.gitignore'))).rejects.toThrow()
  })

  it('does not write the exclude line twice for a second thread', async () => {
    await threads.create({ title: 'One', mode: 'instance', worktree: true })
    await threads.create({ title: 'Two', mode: 'instance', worktree: true })

    const exclude = await fs.readFile(path.join(dir, '.git/info/exclude'), 'utf8')
    expect(exclude.match(/\/\.open-claude\//g)).toHaveLength(1)
  })

  it('refuses a worktree in a folder that is not a repository', async () => {
    const plain = new ThreadService({
      ...terminals.deps,
      git: () => null,
      workspaceRoot: () => dir,
      onChange: () => {}
    })
    await expect(
      plain.create({ title: 'No repo', mode: 'instance', worktree: true })
    ).rejects.toThrow(/not a git repository/i)
  })

  it('refuses to start anything before a folder is open', async () => {
    const rootless = new ThreadService({
      ...terminals.deps,
      git: () => null,
      workspaceRoot: () => null,
      onChange: () => {}
    })
    await expect(
      rootless.create({ title: 'Nowhere', mode: 'instance', worktree: false })
    ).rejects.toThrow(/open a folder/i)
  })

  it('waits for the TUI before typing the opening prompt into it', async () => {
    vi.useFakeTimers()
    const thread = await threads.create({
      title: 'Seeded',
      mode: 'instance',
      worktree: false,
      prompt: 'find the bug'
    })

    // Typing immediately would land before claude is reading stdin and be dropped.
    expect(terminals.writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(3000)

    expect(terminals.writes).toEqual([{ id: 'pty-1', data: 'find the bug\r' }])
    expect(threads.list().find((t) => t.id === thread.id)?.status).toBe('running')
  })

  // -- subagents ------------------------------------------------------------

  it('asks the parent to delegate, since a subagent cannot be launched from outside', async () => {
    const parent = await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    const sub = await threads.create({
      title: 'Audit the routes',
      mode: 'subagent',
      worktree: false,
      prompt: 'list every unauthenticated route'
    })

    expect(sub).toMatchObject({ mode: 'subagent', parentId: parent.id, terminalId: null })
    const [write] = terminals.writes
    expect(write.id).toBe('pty-1')
    expect(write.data).toContain('Task tool')
    expect(write.data).toContain('Audit the routes')
    expect(write.data).toContain('list every unauthenticated route')
  })

  it('defaults to the most recent live instance as the parent', async () => {
    await threads.create({ title: 'Older', mode: 'instance', worktree: false })
    await new Promise((r) => setTimeout(r, 2))
    const newer = await threads.create({ title: 'Newer', mode: 'instance', worktree: false })

    const sub = await threads.create({ title: 'Delegated', mode: 'subagent', worktree: false })
    expect(sub.parentId).toBe(newer.id)
  })

  it('refuses a subagent when there is no instance for it to live in', async () => {
    await expect(
      threads.create({ title: 'Orphan', mode: 'subagent', worktree: false })
    ).rejects.toThrow(/needs a running instance/i)
  })

  it('orders parents before their own children', async () => {
    const a = await threads.create({ title: 'A', mode: 'instance', worktree: false })
    const b = await threads.create({ title: 'B', mode: 'instance', worktree: false })
    await threads.create({ title: 'B-sub', mode: 'subagent', worktree: false, parentId: b.id })
    await threads.create({ title: 'A-sub', mode: 'subagent', worktree: false, parentId: a.id })

    expect(threads.list().map((t) => t.title)).toEqual(['A', 'A-sub', 'B', 'B-sub'])
  })

  // -- hooks ----------------------------------------------------------------

  it('learns which session a thread is from the first hook it delivers', async () => {
    const thread = await threads.create({ title: 'Work', mode: 'instance', worktree: false })
    threads.ingestHook('prompt', { session_id: 'sess-1', cwd: dir })

    const after = threads.list()[0]
    expect(after.sessionId).toBe('sess-1')
    expect(after).toMatchObject({ id: thread.id, status: 'running', detail: 'working' })
  })

  it('routes hooks to the right thread by working directory', async () => {
    const a = await threads.create({ title: 'Alpha', mode: 'instance', worktree: true })
    const b = await threads.create({ title: 'Beta', mode: 'instance', worktree: true })

    threads.ingestHook('prompt', { session_id: 'sess-b', cwd: b.worktree })

    const byId = new Map(threads.list().map((t) => [t.id, t]))
    expect(byId.get(b.id)?.sessionId).toBe('sess-b')
    expect(byId.get(a.id)?.sessionId).toBeNull()
  })

  it('keeps sending a session to its thread once it is known', async () => {
    const first = await threads.create({ title: 'First', mode: 'instance', worktree: false })
    threads.ingestHook('prompt', { session_id: 'sess-1', cwd: dir })
    // A second thread in the same directory must not steal the established session.
    await threads.create({ title: 'Second', mode: 'instance', worktree: false })
    threads.ingestHook('stop', { session_id: 'sess-1', cwd: dir })

    const byId = new Map(threads.list().map((t) => [t.id, t]))
    expect(byId.get(first.id)).toMatchObject({ status: 'idle', detail: 'finished its turn' })
  })

  it('separates a permission request from an ordinary wait', async () => {
    await threads.create({ title: 'Work', mode: 'instance', worktree: false })

    threads.ingestHook('notification', { session_id: 's', cwd: dir, message: 'Claude needs your permission to run Bash' })
    expect(threads.list()[0]).toMatchObject({ status: 'waiting', detail: 'needs permission' })

    threads.ingestHook('notification', { session_id: 's', cwd: dir, message: 'Waiting for your input' })
    expect(threads.list()[0]).toMatchObject({ status: 'waiting', detail: 'waiting on you' })
  })

  it('survives a hook whose payload is missing everything it expects', async () => {
    await threads.create({ title: 'Work', mode: 'instance', worktree: false })
    expect(() => threads.ingestHook('notification', {})).not.toThrow()
    expect(() => threads.ingestHook('unrecognised-kind', { session_id: 's' })).not.toThrow()
    expect(threads.list()).toHaveLength(1)
  })

  it('adds a row for a subagent Claude decided to spawn on its own', async () => {
    const parent = await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    threads.ingestHook('subagent-start', {
      session_id: 's',
      cwd: dir,
      tool_input: { description: 'Sweep the tests', subagent_type: 'Explore' }
    })

    const [, sub] = threads.list()
    expect(sub).toMatchObject({
      title: 'Sweep the tests',
      mode: 'subagent',
      parentId: parent.id,
      agentType: 'Explore',
      status: 'running'
    })
  })

  it('adopts the row the sheet already made rather than adding a duplicate', async () => {
    await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    await threads.create({ title: 'Audit', mode: 'subagent', worktree: false })

    threads.ingestHook('subagent-start', {
      session_id: 's',
      cwd: dir,
      tool_input: { description: 'Audit', subagent_type: 'general-purpose' }
    })

    const subs = threads.list().filter((t) => t.mode === 'subagent')
    expect(subs).toHaveLength(1)
    expect(subs[0]).toMatchObject({ status: 'running', agentType: 'general-purpose' })
  })

  it('closes the matching subagent when several are in flight', async () => {
    await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    for (const description of ['First', 'Second']) {
      threads.ingestHook('subagent-start', { session_id: 's', cwd: dir, tool_input: { description } })
    }

    threads.ingestHook('subagent-stop', {
      session_id: 's',
      cwd: dir,
      tool_input: { description: 'Second' },
      tool_response: 'x'.repeat(400)
    })

    const byTitle = new Map(threads.list().map((t) => [t.title, t]))
    expect(byTitle.get('Second')).toMatchObject({ status: 'done', detail: 'returned about 100 tok' })
    expect(byTitle.get('First')?.status).toBe('running')
  })

  // -- lifecycle ------------------------------------------------------------

  it('adopts a claude terminal opened from the tab bar, and ignores a shell', () => {
    const claude = threads.adoptTerminal({
      id: 'pty-x',
      command: 'claude',
      kind: 'claude',
      cwd: dir,
      title: 'claude'
    })
    const shell = threads.adoptTerminal({
      id: 'pty-y',
      command: 'zsh',
      kind: 'shell',
      cwd: dir,
      title: 'zsh'
    })

    expect(claude?.mode).toBe('instance')
    expect(shell).toBeNull()
    expect(threads.list()).toHaveLength(1)
  })

  it('does not adopt a terminal it spawned itself', async () => {
    await threads.create({ title: 'Mine', mode: 'instance', worktree: false })
    threads.adoptTerminal({
      id: 'pty-1',
      command: 'claude',
      kind: 'claude',
      cwd: dir,
      title: 'Mine'
    })
    expect(threads.list()).toHaveLength(1)
  })

  it('drops an adopted terminal that died without becoming a conversation', () => {
    // StrictMode double-invokes the mount effect, so the renderer spawns two ptys and
    // kills the one it discards. Keeping a row for it left a permanent "session ended"
    // thread in the sidebar on every launch of the app.
    const kept = threads.adoptTerminal({
      id: 'pty-real',
      command: 'claude',
      kind: 'claude',
      cwd: dir,
      title: 'claude'
    })
    threads.adoptTerminal({
      id: 'pty-discarded',
      command: 'claude',
      kind: 'claude',
      cwd: dir,
      title: 'claude'
    })
    expect(threads.list()).toHaveLength(2)

    threads.onTerminalExit('pty-discarded', 0)

    expect(threads.list().map((t) => t.id)).toEqual([kept!.id])
  })

  it('keeps an adopted thread that got as far as a real session', () => {
    threads.adoptTerminal({
      id: 'pty-a',
      command: 'claude',
      kind: 'claude',
      cwd: dir,
      title: 'claude'
    })
    // A session id means there was a conversation, so the row has something to say.
    threads.ingestHook('stop', { session_id: 'sess-1', cwd: dir })

    threads.onTerminalExit('pty-a', 0)

    expect(threads.list()).toHaveLength(1)
    expect(threads.list()[0]).toMatchObject({ status: 'done', detail: 'session ended' })
  })

  it('keeps a thread the user named, even when it dies having done nothing', async () => {
    const thread = await threads.create({ title: 'Mine', mode: 'instance', worktree: false })
    threads.onTerminalExit(thread.terminalId!, 1)

    // Deleting something the user typed a title for would be worse than a stale row:
    // the non-zero exit is the only clue that `claude` failed to start.
    expect(threads.list()).toHaveLength(1)
    expect(threads.list()[0]).toMatchObject({ status: 'failed', detail: 'exited 1' })
  })

  it('ends a thread and its subagents when the pty dies', async () => {
    const parent = await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    threads.ingestHook('subagent-start', { session_id: 's', cwd: dir, tool_input: { description: 'Child' } })

    threads.onTerminalExit(parent.terminalId!, 1)

    const [top, child] = threads.list()
    // A subagent has no process of its own, so it cannot outlive its parent's.
    expect(top).toMatchObject({ status: 'failed', detail: 'exited 1', terminalId: null })
    expect(child).toMatchObject({ status: 'done', detail: 'parent ended' })
    expect(child.endedAt).not.toBeNull()
  })

  it('keeps the branch when closing a thread, and removes only the checkout', async () => {
    const thread = await threads.create({ title: 'Shipped', mode: 'instance', worktree: true })
    await threads.close(thread.id, { removeWorktree: true })

    expect(terminals.killed).toEqual([thread.terminalId])
    await expect(fs.stat(thread.worktree!)).rejects.toThrow()
    // The commits are the output of the thread. Losing them would defeat the point.
    expect((await new GitService(dir).branches()).some((b) => b.name === 'shipped')).toBe(true)
    expect(threads.list()).toHaveLength(0)
  })

  it('leaves the checkout in place when not asked to remove it', async () => {
    const thread = await threads.create({ title: 'Keep', mode: 'instance', worktree: true })
    await threads.close(thread.id)
    expect((await fs.stat(thread.worktree!)).isDirectory()).toBe(true)
  })

  it('takes a thread subagents with it when it closes', async () => {
    const parent = await threads.create({ title: 'Main', mode: 'instance', worktree: false })
    threads.ingestHook('subagent-start', { session_id: 's', cwd: dir, tool_input: { description: 'Child' } })

    await threads.close(parent.id)
    expect(threads.list()).toHaveLength(0)
  })

  // -- diff stats -----------------------------------------------------------

  it('counts committed and uncommitted work on a thread branch', async () => {
    const thread = await threads.create({ title: 'Busy', mode: 'instance', worktree: true })
    const inWorktree = new GitService(thread.worktree!)

    await fs.writeFile(path.join(thread.worktree!, 'done.txt'), 'a\nb\n')
    await inWorktree.stage(['done.txt'])
    await inWorktree.commit('committed', {})
    // Still being edited, and never committed: the case that used to report nothing.
    await fs.writeFile(path.join(thread.worktree!, 'wip.txt'), 'c\nd\ne\n')

    const [refreshed] = await threads.refresh()
    expect(refreshed).toMatchObject({ added: 5, removed: 0 })
  })

  it('leaves a thread with no branch of its own at zero', async () => {
    await threads.create({ title: 'Shared', mode: 'instance', worktree: false })
    await fs.writeFile(path.join(dir, 'noise.txt'), 'not attributable\n')

    const [refreshed] = await threads.refresh()
    expect(refreshed).toMatchObject({ added: 0, removed: 0 })
  })

  it('clears everything when the open folder changes', async () => {
    await threads.create({ title: 'Old project', mode: 'instance', worktree: false })
    threads.clear()

    expect(threads.list()).toEqual([])
    // The renderer is driven by this event, so a silent clear would leave stale rows.
    expect(changes.at(-1)).toEqual([])
  })
})
