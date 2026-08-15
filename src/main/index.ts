import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc, type AppServices } from './ipc'
import { TerminalService } from './services/TerminalService'
import { PortService } from './services/PortService'
import { AutomationService } from './services/AutomationService'
import { NotificationService } from './services/NotificationService'
import { classifyHook } from './services/hookEvent'
import { AlertWindow } from './AlertWindow'
import { ControlBridge } from './mcp/bridge'
import { writeMcpConfig, writeHookSettings } from './mcp/config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

let window: BrowserWindow | null = null

const services: AppServices = {
  terminals: new TerminalService(),
  ports: new PortService(),
  automation: new AutomationService(),
  notifications: new NotificationService(),
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
    window.webContents.on('render-process-gone', (_e, details) =>
      console.error('[renderer] process gone:', details.reason)
    )

    void window.loadURL(devServer)
  } else {
    void window.loadFile(path.join(dirname, '../renderer/index.html'))
  }
}

// In dev, expose the editor's own window over CDP. This is what lets Claude inspect
// and screenshot Metsuke's UI while building it — the same trick the preview pane
// gives you for your project, turned back on the editor itself.
if (process.env['ELECTRON_RENDERER_URL']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['METSUKE_DEBUG_PORT'] ?? '9222')
}

app.whenReady().then(async () => {
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

  registerIpc(services, () => window)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  services.alerts.destroy()
  services.terminals.disposeAll()
  services.ports.stop()
  services.automation.detach()
  bridge.stop()
  void services.workspace?.dispose()
})
