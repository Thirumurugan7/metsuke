import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import {
  err,
  ok,
  type EventChannel,
  type EventChannels,
  type InvokeChannel,
  type InvokeChannels,
  type Result
} from '@shared/ipc'
import { WorkspaceContext } from './workspace'
import { TerminalService } from './services/TerminalService'
import { PortService } from './services/PortService'
import { AutomationService } from './services/AutomationService'
import { NotificationService } from './services/NotificationService'
import { AlertWindow } from './AlertWindow'
import { UpdateService } from './updates'
import { TelemetryService } from './services/TelemetryService'
import { TELEMETRY_ENDPOINT } from './telemetryConfig'
import { GitError } from './services/GitService'
import { systemCheck, clearSystemCheck } from './services/systemCheck'
import { ClaudeService } from './services/ClaudeService'
import { ThreadService } from './services/ThreadService'

/** Long-lived services, independent of which folder is open. */
export interface AppServices {
  terminals: TerminalService
  ports: PortService
  automation: AutomationService
  notifications: NotificationService
  updates: UpdateService
  telemetry: TelemetryService
  alerts: AlertWindow
  /** The currently open folder, or null. */
  workspace: WorkspaceContext | null
  /** Path to the generated MCP config handed to the embedded `claude`. */
  mcpConfigPath: string | null
  /** Path to the generated hook settings handed to the embedded `claude`. */
  hookSettingsPath: string | null
  /** Threads, built in registerIpc once the terminal and git plumbing exists. */
  threads: ThreadService | null
  /** Forget which capabilities have been used, so a new folder can be adapted to afresh. */
  resetAdaptations: () => void
  /**
   * Model passed to sessions the editor starts. Null follows the user's global default,
   * which the editor deliberately never rewrites.
   */
  sessionModel: string | null
}

/**
 * Appended to the system prompt of every Claude session the editor starts.
 *
 * Without this, Claude reaches for the Chrome extension out of habit and drives a
 * browser the user is not looking at.
 */
const EDITOR_SYSTEM_PROMPT = [
  'You are running inside the Metsuke editor, in a terminal beside a live preview pane.',
  '',
  'To look at or interact with a web page, use the preview_* tools (preview_navigate,',
  'preview_snapshot, preview_click, preview_type, preview_screenshot, preview_console,',
  'preview_network, preview_wait_for). They drive the editor\'s preview pane, which is the',
  'browser the user can actually see. Do not use the Chrome extension tools — they control a',
  'separate window the user is not watching, and they are disabled in this session.',
  '',
  'When the user refers to "the preview", "the page", or something they can see on screen,',
  'they mean the preview pane. If the user sends a message tagged [preview element], they',
  'clicked that element in the preview and the CSS selector is exact — use it directly.'
].join('\n')

/**
 * Chrome-extension tools, denied in editor sessions.
 *
 * The settings file already carries a server-level deny rule, but that alone was not
 * enough in practice — Claude kept reaching for the extension. These go on the command
 * line as well, and the individual tool names are listed alongside the server-level
 * pattern because a rule that does not match is silently a no-op.
 */
const CHROME_TOOLS = [
  'mcp__claude-in-chrome',
  'mcp__claude-in-chrome__navigate',
  'mcp__claude-in-chrome__computer',
  'mcp__claude-in-chrome__read_page',
  'mcp__claude-in-chrome__get_page_text',
  'mcp__claude-in-chrome__find',
  'mcp__claude-in-chrome__form_input',
  'mcp__claude-in-chrome__javascript_tool',
  'mcp__claude-in-chrome__read_console_messages',
  'mcp__claude-in-chrome__read_network_requests',
  'mcp__claude-in-chrome__browser_batch',
  'mcp__claude-in-chrome__tabs_context_mcp',
  'mcp__claude-in-chrome__tabs_create_mcp',
  'mcp__claude-in-chrome__tabs_close_mcp',
  'mcp__claude-in-chrome__resize_window',
  'mcp__claude-in-chrome__select_browser',
  'mcp__claude-in-chrome__switch_browser',
  'mcp__claude-in-chrome__list_connected_browsers',
  'mcp__claude-in-chrome__upload_image',
  'mcp__claude-in-chrome__file_upload',
  'mcp__claude-in-chrome__gif_creator',
  'mcp__claude-in-chrome__shortcuts_list',
  'mcp__claude-in-chrome__shortcuts_execute'
]

type Handler<C extends InvokeChannel> = (
  ...args: InvokeChannels[C]['args']
) => Promise<InvokeChannels[C]['result']> | InvokeChannels[C]['result']

/**
 * Wires the IPC contract to the services.
 *
 * Every handler is wrapped so a throw becomes `{ ok: false, error }` rather than an
 * opaque "Error invoking remote method" in the renderer. The UI can then render the
 * real message — git's stderr, a path-jail violation — inline where it happened.
 */
export function registerIpc(services: AppServices, getWindow: () => BrowserWindow | null): void {
  const handle = <C extends InvokeChannel>(channel: C, handler: Handler<C>): void => {
    ipcMain.handle(channel, async (_event, ...args): Promise<Result<unknown>> => {
      try {
        return ok(await handler(...(args as InvokeChannels[C]['args'])))
      } catch (e) {
        return err(errorMessage(e))
      }
    })
  }

  /** The open workspace, or a throw that becomes a clean error Result. */
  const ws = (): WorkspaceContext => {
    if (!services.workspace) throw new Error('No folder is open')
    return services.workspace
  }

  const emit = <C extends EventChannel>(channel: C, ...args: EventChannels[C]): void => {
    getWindow()?.webContents.send(channel, ...args)
  }

  // -- workspace ------------------------------------------------------------

  // True once `openFolder` has run at least once in this process. A renderer-only
  // reload keeps `services.workspace` populated, so the root comparison below already
  // tells "same project" from "switched project" correctly — but a main-process
  // restart (dev hot-reload, or main recovering while the detached pty host keeps
  // running) rebuilds `services` from scratch, so `previousRoot` reads `null` on the
  // very first call even when it is the same project reopening. That made the
  // very-first call always look like a switch and wipe threads adopted from sessions
  // reattached moments earlier. The first call in a fresh process has nothing genuine
  // to compare against, so it never clears.
  let openedOnceThisProcess = false

  const openFolder = async (root: string) => {
    const previousRoot = services.workspace?.info.root ?? null
    const firstCallThisProcess = !openedOnceThisProcess
    openedOnceThisProcess = true

    await services.workspace?.dispose()
    const context = await WorkspaceContext.open(root)
    services.workspace = context
    // A different project is a different thing to adapt to.
    services.resetAdaptations()

    /*
     * Threads belong to a project, so switching project drops them. Reopening the same
     * one must not: this runs again on every renderer reload, and clearing there threw
     * away the list of agents still running in the background, which is precisely what
     * a reload is supposed to survive.
     */
    if (!firstCallThisProcess && previousRoot !== context.info.root) services.threads?.clear()

    // Bring back threads from an earlier run of the app. Their processes are gone, but
    // their branches and worktrees are still on disk, so they come back finished and
    // landable rather than not at all.
    await services.threads?.restore()

    context.watcher.start((paths) => {
      emit('files:changed', paths)
      // Any file change can move git status, so recompute it alongside.
      void context.git
        ?.status()
        .then((status) => emit('git:changed', status))
        .catch(() => {})
    })

    return context.info
  }

  handle('workspace:open', async () => {
    const window = getWindow()
    const result = await (window
      ? dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    if (result.canceled || result.filePaths.length === 0) return null
    return openFolder(result.filePaths[0])
  })

  // Re-probe on an explicit open: someone who just installed Claude should not have to
  // restart the editor to be told it worked.
  handle('system:check', () => systemCheck())
  handle('app:openExternal', (url) => shell.openExternal(url))
  handle('workspace:openPath', (root) => {
    clearSystemCheck()
    return openFolder(root)
  })
  handle('workspace:current', () => services.workspace?.info ?? null)
  handle('workspace:close', async () => {
    await services.workspace?.dispose()
    services.workspace = null
  })

  // -- files ----------------------------------------------------------------

  handle('files:list', (dir) => ws().files.list(dir))
  handle('files:all', () => ws().files.allFiles())
  handle('files:read', (p) => ws().files.read(p))
  handle('files:write', (p, contents) => ws().files.write(p, contents))
  handle('files:create', (p, isDirectory) => ws().files.create(p, isDirectory))
  handle('files:rename', (from, to) => ws().files.rename(from, to))
  handle('files:delete', (p) => ws().files.delete(p))
  handle('files:search', (query, opts) => ws().files.search(query, opts))
  handle('files:replace', (query, replacement, opts) =>
    ws().files.replace(query, replacement, opts)
  )

  // -- git ------------------------------------------------------------------

  handle('git:status', () => ws().requireGit().status())
  handle('git:diff', (p, kind) => ws().requireGit().diff(p, kind))
  handle('git:stage', (paths) => ws().requireGit().stage(paths))
  handle('git:unstage', (paths) => ws().requireGit().unstage(paths))
  handle('git:discard', (paths) => ws().requireGit().discard(paths))
  handle('git:commit', (message, opts) => ws().requireGit().commit(message, opts))
  handle('git:branches', () => ws().requireGit().branches())
  handle('git:checkout', (branch, opts) => ws().requireGit().checkout(branch, opts))
  handle('git:push', (opts) => ws().requireGit().push(opts))
  handle('git:pull', (opts) => ws().requireGit().pull(opts))
  handle('git:fetch', () => ws().requireGit().fetch())
  handle('git:stash', (message) => ws().requireGit().stash(message))
  handle('git:log', (opts) => ws().requireGit().log(opts))
  handle('git:dirtyStat', () => ws().requireGit().dirtyStat())

  // -- terminal -------------------------------------------------------------

  services.terminals.listen({
    onData: (id, data) => emit('terminal:data', id, data),
    onExit: (id, exitCode) => {
      emit('terminal:exit', id, exitCode)
      services.threads?.onTerminalExit(id, exitCode)
    }
  })

  /**
   * Spawn a terminal, wiring the editor's tooling into it when it is a Claude session.
   *
   * Shared by the terminal tabs and by ThreadService, so a thread and a hand-opened tab
   * get identical sessions. Anything but `claude` is spawned untouched.
   */
  const spawnTerminal = (opts: Parameters<typeof services.terminals.spawn>[0] = {}) => {
    const spawnOpts = { cwd: services.workspace?.info.root, ...opts }

    // A `claude` session gets the preview tools wired in automatically — that is the
    // whole point of the editor, and asking the user to configure MCP by hand would
    // defeat it.
    if (spawnOpts.command === 'claude') {
      const flags: string[] = []
      if (services.mcpConfigPath) flags.push('--mcp-config', services.mcpConfigPath)
      // Hooks are what tell the editor Claude wants permission, has gone idle, or has
      // delegated a subagent.
      if (services.hookSettingsPath) flags.push('--settings', services.hookSettingsPath)
      // Only when the user picked one. Otherwise their own default applies.
      if (services.sessionModel) flags.push('--model', services.sessionModel)
      // Denying the Chrome tools stops the wrong browser being used; the appended prompt
      // says what to use instead, so Claude does not simply conclude it has no browser.
      flags.push('--disallowedTools', ...CHROME_TOOLS)
      flags.push('--append-system-prompt', EDITOR_SYSTEM_PROMPT)
      spawnOpts.args = [...flags, ...(spawnOpts.args ?? [])]
    }

    return services.terminals.spawn(spawnOpts)
  }

  handle('terminal:spawn', (opts) => {
    const session = spawnTerminal(opts)
    // A Claude terminal opened from the tab bar is a thread too, or the list would
    // quietly disagree with what is running.
    services.threads?.adoptTerminal(session)
    return session
  })
  handle('terminal:write', (id, data) => services.terminals.write(id, data))
  handle('terminal:resize', (id, cols, rows) => services.terminals.resize(id, cols, rows))
  handle('terminal:kill', (id) => services.terminals.kill(id))
  handle('terminal:list', () => services.terminals.list())
  handle('terminal:history', (id) => services.terminals.history(id))

  // -- threads --------------------------------------------------------------

  services.threads = new ThreadService({
    spawnTerminal,
    writeTerminal: (id, data) => services.terminals.write(id, data),
    killTerminal: (id) => services.terminals.kill(id),
    // Null rather than a throw: a thread in a plain folder is fine, it just cannot have
    // a worktree, and that check belongs in the one place that needs it.
    git: () => services.workspace?.git ?? null,
    workspaceRoot: () => services.workspace?.info.root ?? null,
    onChange: (threads) => emit('threads:changed', threads)
  })

  handle('threads:list', () => services.threads!.list())
  handle('threads:create', (opts) => services.threads!.create(opts))
  handle('threads:close', (id, opts) => services.threads!.close(id, opts))
  handle('threads:refresh', () => services.threads!.refresh())
  handle('threads:mergePreview', (id) => services.threads!.mergePreview(id))
  handle('threads:merge', async (id, opts) => {
    await services.threads!.merge(id, opts)
    // The merge changed the branch the user is looking at, so the git panel and the
    // file tree are both stale until they are told.
    const status = await services.workspace?.git?.status()
    if (status) emit('git:changed', status)
  })

  // -- ports ----------------------------------------------------------------

  services.ports.start(
    () => services.terminals.pids(),
    (ports) => emit('ports:changed', ports)
  )
  handle('ports:list', () => services.ports.list())

  // -- claude ---------------------------------------------------------------

  const claude = new ClaudeService()

  handle('claude:usage', () => claude.usage(services.workspace?.info.root ?? null))
  handle('claude:skills', () => claude.skills(services.workspace?.info.root ?? null))
  handle('claude:config', () => claude.config(services.sessionModel))
  handle('claude:setModel', (model) => {
    services.sessionModel = model
  })

  // -- notifications --------------------------------------------------------

  services.notifications.listen((payload) => {
    // The renderer still hears about every alert so it can keep the history and play
    // the sound; the visible pop-up is the floating window, which works no matter which
    // application is in front.
    emit('notify:fired', payload)
    if (services.notifications.popup) {
      services.alerts.present(payload, { takeFocus: services.notifications.focusWindow })
    }
  })

  handle('telemetry:get', () => ({
    consent: services.telemetry.consent,
    configured: TELEMETRY_ENDPOINT.length > 0,
    installId: services.telemetry.installId
  }))
  handle('telemetry:setConsent', (granted) => services.telemetry.setConsent(granted))
  // The renderer sees things main cannot: which panel is open, which theme, which
  // overlay. It cannot invent an event shape, only pick one from the schema.
  handle('telemetry:record', (event) => services.telemetry.record(event))

  handle('updates:get', () => services.updates.state)
  handle('updates:setEnabled', (enabled) => services.updates.setEnabled(enabled))
  handle('updates:check', () => services.updates.check())
  handle('updates:install', () => services.updates.install())

  handle('notify:get', () => services.notifications.read())
  handle('notify:set', (settings) => services.notifications.update(settings))
  handle('notify:test', (channel) => services.notifications.test(channel))
  handle('notify:sound', () => services.notifications.soundData())

  handle('notify:pickSound', async () => {
    const window = getWindow()
    const result = await dialog.showOpenDialog(window ?? undefined!, {
      title: 'Choose an alert sound',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const path = result.filePaths[0]
    await services.notifications.update({ sound: { enabled: true, path, volume: 0.7 } })
    return path
  })

  // -- floating alert window ------------------------------------------------

  handle('alert:ready', () => services.alerts.markReady())
  handle('alert:dismiss', () => services.alerts.hide())

  handle('alert:goto', (sessionId) => {
    services.alerts.hide()
    const window = getWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    emit('notify:goto', sessionId)
  })

  // -- preview automation ---------------------------------------------------

  services.automation.listen({
    onConsole: (message) => emit('preview:console', message),
    onNavigate: (url) => emit('preview:navigated', url),
    onPick: (element) => emit('preview:elementPicked', element)
  })

  handle('preview:inspectStart', () => services.automation.startInspect())
  handle('preview:inspectStop', () => services.automation.stopInspect())

  handle('preview:comment', (sessionId, element, comment, url) => {
    /*
     * Typed into the pty exactly as the user would type it, so it lands in whatever
     * Claude is doing — a fresh prompt, or mid-conversation — with no special protocol.
     *
     * Flattened to a single line: a newline inside the text would submit the message
     * early and leave the rest as a second, meaningless prompt.
     */
    const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

    const described = [
      `[preview element] ${oneLine(element.selector)}`,
      element.text ? ` — text: "${oneLine(element.text).slice(0, 120)}"` : '',
      url ? ` — on ${url}` : '',
      `. ${oneLine(comment)}`
    ].join('')

    services.terminals.write(sessionId, described)
    // Separate write so the text is fully buffered before submission.
    services.terminals.write(sessionId, '\r')

    emit('adapt:fired', { skill: 'your instruction', at: Date.now() })
  })

  handle('preview:register', (id) => services.automation.attach(id))
  handle('preview:navigate', (url) => services.automation.navigate(url))
  handle('preview:reload', () => services.automation.reload())
  handle('preview:console', (opts) => services.automation.consoleMessages(opts))
  handle('preview:network', (opts) => services.automation.networkRequests(opts))
  handle('preview:clear', () => services.automation.clearBuffers())
}

/** Git's stderr is more useful than the wrapper message, so prefer it when present. */
function errorMessage(e: unknown): string {
  if (e instanceof GitError) return e.stderr || e.message
  if (e instanceof Error) return e.message
  return String(e)
}
