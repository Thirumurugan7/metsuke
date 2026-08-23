import { app, BrowserWindow, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc, type AppServices } from './ipc'
import { installCrashHandlers, type CrashHandlers } from './crash'
import { UpdateService } from './updates'
import { TelemetryService } from './services/TelemetryService'
import { TELEMETRY_ENDPOINT } from './telemetryConfig'
import { attachPtyHost } from './ptyHostLauncher'
import { TerminalService } from './services/TerminalService'
import { PortService } from './services/PortService'
import { AutomationService } from './services/AutomationService'
import { NotificationService } from './services/NotificationService'
import { classifyHook } from './services/hookEvent'
import { systemCheck } from './services/systemCheck'
import { AlertWindow } from './AlertWindow'
import { ControlBridge } from './mcp/bridge'
import { writeMcpConfig, writeHookSettings } from './mcp/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/*
 * A run from the repo and an installed build are two different apps that happen to
 * share a name, and userData is not a cache: it holds mcp-preview.json, which carries
 * the control bridge's port and token, and claude-hooks.json, which points every hook
 * at them. With one directory between them, launching the packaged app rewrote both
 * under the running dev app, and its notification hooks then failed silently against a
 * bridge that had never been listening on that port. It cost an afternoon.
 *
 * isPackaged rather than ELECTRON_RENDERER_URL, because `electron-vite preview` runs
 * the built output with no dev server and is still a run from the repo.
 *
 * This has to happen before anything reads the path. Paths are readable before ready,
 * so module scope is the only place it is certainly early enough.
 *
 * An explicit --user-data-dir is left alone. The UI suite passes one to get a throwaway
 * profile, and suffixing it would move the profile to a sibling directory the suite
 * never made and does not clean up.
 *
 * The directory is created here rather than left to whoever writes first. Chromium's
 * devtools handler writes DevToolsActivePort into userData during startup, ahead of
 * anything the app does, and logged a "No such file or directory" error on every launch
 * until this line existed. The port is hardcoded to 9222 so nothing broke, which is
 * exactly why it would have stayed in the log unexplained.
 */
const pinnedProfile = process.argv.some((arg) => arg.startsWith('--user-data-dir'))

if (!app.isPackaged && !pinnedProfile) {
  const devUserData = `${app.getPath('userData')} (dev)`
  fs.mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
}

let window: BrowserWindow | null = null

/*
 * Installed at ready, before the first window, and held here because createWindow has to
 * hand each new renderer to it. Null until then, which is why the call site is optional:
 * a crash before ready has no window to rebuild and nowhere to show a dialog anyway.
 */
let crash: CrashHandlers | null = null

const services: AppServices = {
  terminals: new TerminalService(),
  ports: new PortService(),
  automation: new AutomationService(),
  notifications: new NotificationService(),
  updates: new UpdateService(app.getPath('userData')),
  telemetry: new TelemetryService(app.getPath('userData'), {
    endpoint: TELEMETRY_ENDPOINT,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    // Major version only. "14" says which OS to support; "14.6.1 build 23G93" is close
    // enough to unique to be an identifier.
    osVersion: os.release().split('.')[0] ?? '',
    homeDir: app.getPath('home')
  }),
  alerts: new AlertWindow(),
  workspace: null,
  mcpConfigPath: null,
  sessionModel: null,
  hookSettingsPath: null,
  // Built by registerIpc, which is where the terminal and git plumbing it needs lives.
  threads: null,
  resetAdaptations: () => bridge.resetAdaptations()
}

const bridge = new ControlBridge(services.automation)

function createWindow(): void {
  window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.cjs'),
      // The editor's own renderer stays locked down. It reaches the filesystem only
      // through the IPC contract, never directly — which is what makes it safe to give
      // the preview webview unrestricted automation.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Required for the <webview> element that hosts the preview.
      webviewTag: true
    }
  })

  window.on('ready-to-show', () => window?.show())
  // Clear the attention cue once the user actually looks at the window.
  window.on('focus', () => window?.flashFrame(false))

  /*
   * Terminals deliberately outlive the renderer.
   *
   * They used to be killed whenever the frame started loading, which was a blunt fix
   * for ptys leaking across reloads. But that fires on every reload — including an HMR
   * refresh and a renderer crash — so a long-running `claude` session died for entirely
   * unrelated reasons, which defeats the point of the editor.
   *
   * Sessions now belong to the app, not to a page load. The renderer re-adopts whatever
   * is still running for the open folder (see restoreTerminals in the store), so they
   * cannot accumulate: a reload reconnects to the same ptys rather than spawning more.
   * Anything left for a folder that is no longer open is killed at adoption time, and
   * everything is killed on quit.
   */

  // Links that would replace the editor open in the user's real browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    // Surface renderer errors in the terminal running `npm run dev`, so a blank window
    // has a visible cause instead of requiring devtools to be opened first.
    const levels = ['debug', 'info', 'warning', 'error'] as const
    window.webContents.on('console-message', (_e, level, message, line, source) => {
      const tag = levels[level] ?? 'log'
      if (tag === 'error' || tag === 'warning') {
        console.error(`[renderer:${tag}] ${message}  (${source}:${line})`)
      }
    })
    void window.loadURL(devServer)
  } else {
    void window.loadFile(path.join(dirname, '../renderer/index.html'))
  }

  // After load, not before: a crash during startup should still be recorded, and the
  // handler is installed once per window because each one gets its own renderer.
  crash?.watch(window)
}

/*
 * Keep frames coming when the window is not in front.
 *
 * Chromium stops producing frames for a window it considers occluded or backgrounded,
 * and Page.captureScreenshot has nothing to return, so it does not fail: it hangs until
 * the caller times out. preview_screenshot was therefore unreliable in precisely the
 * situation this editor is built for, an agent working while you look at something else,
 * and the failure told you nothing about why.
 *
 * These are the three switches the UI suite already relies on to capture an off-screen
 * window, applied to every build rather than just the tests. The cost is that a hidden
 * window keeps rendering and its timers keep firing, which is the point.
 */
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// In dev, expose the editor's own window over CDP. This is what lets Claude inspect
// and screenshot Metsuke's UI while building it — the same trick the preview pane
// gives you for your project, turned back on the editor itself.
if (process.env['ELECTRON_RENDERER_URL']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['METSUKE_DEBUG_PORT'] ?? '9222')
}

app.whenReady().then(async () => {
  // First, so that anything below failing is recorded rather than silent.
  crash = installCrashHandlers(
    () => createWindow(),
    (kind, error) =>
      services.telemetry.record({
        name: 'error',
        kind,
        errorName: error.name || 'Error',
        message: error.message || String(error),
        stack: error.stack
      })
  )

  // The webview's own preferences are set from the main process; the renderer cannot
  // widen them. webSecurity is off *inside the preview only*, so dev servers with
  // loose CORS and self-signed certs work without fighting the browser.
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview') {
      contents.on('will-attach-webview', (_e, prefs) => {
        delete prefs.preload
        prefs.nodeIntegration = false
        prefs.contextIsolation = true
      })
    }
  })

  await bridge.start()
  services.mcpConfigPath = await writeMcpConfig(bridge)
  services.hookSettingsPath = await writeHookSettings()
  await services.notifications.load()
  await services.telemetry.load()

  // One per launch, once the machine has been probed, so the counts can answer the
  // question the welcome screen exists for: how many people have Claude Code installed.
  const recordLaunch = (): void => {
    void systemCheck().then((check) =>
      services.telemetry.record({
        name: 'app_launched',
        firstRun: services.telemetry.firstRun,
        claudeInstalled: check.claude.installed,
        gitInstalled: check.git.installed
      })
    )
  }

  // And again if consent arrives mid-session, since the call above was a no-op then.
  services.telemetry.onActivated(recordLaunch)
  recordLaunch()

  /*
   * Ptys move into their own process here, before anything can spawn one. Sessions from
   * a previous run of the editor come back attached rather than as an empty pane; see
   * PtyHost for why they cannot simply live in this process.
   */
  const restored = await attachPtyHost(services.terminals)
  if (restored.length > 0) {
    console.log(`[terminals] reattached ${restored.length} session(s) from the pty host`)
  }
  await services.updates.start(() => window)

  // Hooks reach the bridge using these, so they must be in the pty's environment
  // before any `claude` session starts.
  services.terminals.setEnv({
    METSUKE_CONTROL_URL: `http://127.0.0.1:${bridge.port}`,
    METSUKE_CONTROL_TOKEN: bridge.token
  })

  bridge.onHook(async (kind, body) => {
    let hook: Record<string, unknown> = {}
    try {
      hook = JSON.parse(body) as Record<string, unknown>
    } catch {
      // A hook with an unreadable body is still worth surfacing.
    }

    // Every hook updates the thread list, including the ones that never alert.
    services.threads?.ingestHook(kind, hook)

    /*
     * Only two kinds are a request for attention. The rest exist to track threads, and
     * routing them here as well would fire a pop-up and a phone notification every time
     * Claude delegated a subagent or the user pressed enter.
     */
    if (kind !== 'notification' && kind !== 'stop') return

    const message = typeof hook.message === 'string' ? hook.message : ''
    await services.notifications.fire(
      classifyHook(kind, message),
      message,
      typeof hook.session_id === 'string' ? hook.session_id : null
    )

    // A dock bounce is a quiet secondary cue; the floating alert does the real work.
    if (window && !window.isFocused()) {
      if (process.platform === 'darwin') app.dock?.bounce('informational')
      else window.flashFrame(true)
    }
  })

  // Claude reaching for a capability it has not used yet is the moment the wheel turns.
  bridge.onAdapt((skill) => window?.webContents.send('adapt:fired', { skill, at: Date.now() }))

  // Claude navigating with the pane shut opens the pane, rather than telling the user to
  // go and click something. See the preview_navigate case in the bridge.
  bridge.onOpenPreview((url) => window?.webContents.send('preview:open', url))

  registerIpc(services, () => window)

  // Reattached sessions never went through terminal:spawn, so they were never adopted
  // as threads — without this, a session that survives a main-process restart (dev
  // hot-reload, or main crashing while the detached pty host keeps running) shows
  // running/pending forever in the tab dot instead of the real hook-driven state.
  for (const session of restored) services.threads?.adoptTerminal(session)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const launchedAt = Date.now()

app.on('before-quit', () => {
  services.telemetry.record({
    name: 'app_closed',
    sessionSeconds: Math.round((Date.now() - launchedAt) / 1000)
  })
  // Fire and forget: a quit must not wait on the network, and anything unsent is
  // written to disk by shutdown() for the next run to carry.
  void services.telemetry.shutdown()

  services.alerts.destroy()
  services.terminals.disposeAll()
  services.ports.stop()
  services.automation.detach()
  bridge.stop()
  void services.workspace?.dispose()
})
