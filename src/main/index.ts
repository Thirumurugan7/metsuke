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
  hookSettingsPath: null
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

  /**
   * Terminals belong to the renderer session that opened them. A reload — or an HMR
   * full refresh, or a renderer crash — throws that session away without running React
   * cleanup, so the ptys were surviving as orphans: seven live `claude` processes
   * accumulated behind a UI showing one tab. Killing them as the frame starts loading
   * happens before the new renderer spawns its own.
   */
  window.webContents.on('did-start-loading', () => services.terminals.killAll())
  window.webContents.on('render-process-gone', () => services.terminals.killAll())

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
// and screenshot Open Claude's UI while building it — the same trick the preview pane
// gives you for your project, turned back on the editor itself.
if (process.env['ELECTRON_RENDERER_URL']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['OPEN_CLAUDE_DEBUG_PORT'] ?? '9222')
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
    OPEN_CLAUDE_CONTROL_URL: `http://127.0.0.1:${bridge.port}`,
    OPEN_CLAUDE_CONTROL_TOKEN: bridge.token
  })

  bridge.onHook(async (kind, body) => {
    let hook: { message?: string; session_id?: string } = {}
    try {
      hook = JSON.parse(body)
    } catch {
      // A hook with an unreadable body is still worth surfacing.
    }

    const message = hook.message ?? ''
    await services.notifications.fire(
      classifyHook(kind, message),
      message,
      hook.session_id ?? null
    )

    // A dock bounce is a quiet secondary cue; the floating alert does the real work.
    if (window && !window.isFocused()) {
      if (process.platform === 'darwin') app.dock?.bounce('informational')
      else window.flashFrame(true)
    }
  })

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
