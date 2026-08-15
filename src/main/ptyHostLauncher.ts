import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { socketPathFor } from './services/PtyHost'
import type { TerminalService } from './services/TerminalService'

/** Attempts to connect after starting a host, before giving up on it. */
const CONNECT_ATTEMPTS = 20
const CONNECT_DELAY_MS = 100

/**
 * Start the pty host if it is not already running, and attach to it.
 *
 * The host is started detached, with its stdio ignored and unref'd, because the entire
 * point is that it is not a child this process can take down. On a second launch there
 * is usually nothing to start: the host from the previous run is still there holding the
 * sessions, which is what makes them survive.
 *
 * Every failure here is answered by returning nothing and letting TerminalService run
 * ptys in-process, as it always did. A terminal that does not survive a restart is a
 * disappointment; a terminal that does not open is a broken editor.
 */
export async function attachPtyHost(terminals: TerminalService): Promise<string[]> {
  const userData = app.getPath('userData')
  const socketPath = socketPathFor(userData)
  const token = readOrCreateToken(path.join(userData, 'pty-token'))

  const restored = await tryAttach(terminals, socketPath, token)
  if (restored) return restored

  try {
    launch(socketPath, token)
  } catch (error) {
    console.error('[terminals] could not start the pty host:', error)
    return []
  }

  // The host has to bind before anything can connect, and there is no signal to wait on
  // from a process we deliberately do not hold a handle to.
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, CONNECT_DELAY_MS))
    const sessions = await tryAttach(terminals, socketPath, token)
    if (sessions) return sessions
  }

  console.error('[terminals] pty host never came up; running ptys in-process')
  return []
}

async function tryAttach(
  terminals: TerminalService,
  socketPath: string,
  token: string
): Promise<string[] | null> {
  try {
    const sessions = await terminals.attach(socketPath, token)
    return sessions.map((session) => session.id)
  } catch {
    // No host yet, or one that will not have us. Either way the caller starts one.
    return null
  }
}

function launch(socketPath: string, token: string): void {
  /*
   * Electron in node mode, the same trick the MCP server uses. node-pty is a native
   * module compiled against Electron's ABI, so loading it under whatever `node` is on
   * PATH would fail on the module version — and on a packaged machine there may be no
   * node at all.
   */
  const entry = path.join(path.dirname(app.getAppPath()), 'app.asar', 'out', 'main', 'pty-host.js')
  const script = fs.existsSync(entry)
    ? entry
    : path.join(app.getAppPath(), 'out', 'main', 'pty-host.js')

  /*
   * The host's output goes to a file rather than nowhere. It is detached, so there is no
   * terminal to inherit, and a process that holds every session in the app must be able
   * to say why it failed: with stdio ignored, a host that could not load node-pty looked
   * exactly like a host that was working.
   */
  const log = fs.openSync(path.join(app.getPath('userData'), 'pty-host.log'), 'a')

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      METSUKE_PTY_SOCKET: socketPath,
      METSUKE_PTY_TOKEN: token
    }
  })
  child.unref()
}

/**
 * The token that guards the socket, stable across runs so a reconnecting editor is let
 * back in to its own sessions.
 */
function readOrCreateToken(file: string): string {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch {
    // Not written yet.
  }

  const token = randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 })
  return token
}
