import { ipcMain, dialog, BrowserWindow } from 'electron'
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
import { GitError } from './services/GitService'

/** Long-lived services, independent of which folder is open. */
export interface AppServices {
  terminals: TerminalService
  ports: PortService
  automation: AutomationService
  notifications: NotificationService
  /** The currently open folder, or null. */
  workspace: WorkspaceContext | null
  /** Path to the generated MCP config handed to the embedded `claude`. */
  mcpConfigPath: string | null
  /** Path to the generated hook settings handed to the embedded `claude`. */
  hookSettingsPath: string | null
}

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

  const openFolder = async (root: string) => {
    await services.workspace?.dispose()
    const context = await WorkspaceContext.open(root)
    services.workspace = context

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

  handle('workspace:openPath', (root) => openFolder(root))
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
  handle('git:log', (opts) => ws().requireGit().log(opts))

  // -- terminal -------------------------------------------------------------

  services.terminals.listen({
    onData: (id, data) => emit('terminal:data', id, data),
    onExit: (id, exitCode) => emit('terminal:exit', id, exitCode)
  })

  handle('terminal:spawn', (opts) => {
    const spawnOpts = { cwd: services.workspace?.info.root, ...opts }

    // A `claude` session gets the preview tools wired in automatically — that is the
    // whole point of the editor, and asking the user to configure MCP by hand would
    // defeat it. Any other command is spawned untouched.
    if (spawnOpts.command === 'claude') {
      const flags: string[] = []
      if (services.mcpConfigPath) flags.push('--mcp-config', services.mcpConfigPath)
      // Hooks are what tell the editor Claude wants permission or has gone idle.
      if (services.hookSettingsPath) flags.push('--settings', services.hookSettingsPath)
      spawnOpts.args = [...flags, ...(spawnOpts.args ?? [])]
    }

    return services.terminals.spawn(spawnOpts)
  })
  handle('terminal:write', (id, data) => services.terminals.write(id, data))
  handle('terminal:resize', (id, cols, rows) => services.terminals.resize(id, cols, rows))
  handle('terminal:kill', (id) => services.terminals.kill(id))
  handle('terminal:list', () => services.terminals.list())

  // -- ports ----------------------------------------------------------------

  services.ports.start(
    () => services.terminals.pids(),
    (ports) => emit('ports:changed', ports)
  )
  handle('ports:list', () => services.ports.list())

  // -- notifications --------------------------------------------------------

  services.notifications.listen((payload) => emit('notify:fired', payload))

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

  // -- preview automation ---------------------------------------------------

  services.automation.listen({
    onConsole: (message) => emit('preview:console', message),
    onNavigate: (url) => emit('preview:navigated', url)
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
