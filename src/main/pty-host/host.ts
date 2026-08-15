/**
 * The pty host, as a process.
 *
 * Launched detached by the editor and deliberately outliving it: see PtyHost for why the
 * ptys cannot stay in the main process. This file is only the shell around that class,
 * so there is as little as possible here that can go wrong in a process nobody is
 * watching.
 *
 * It is spawned the same way the MCP server is, with the Electron binary in
 * ELECTRON_RUN_AS_NODE mode, so node-pty is loaded by the runtime it was compiled
 * against rather than whatever `node` happens to be on PATH.
 */
import os from 'node:os'
import * as pty from 'node-pty'
import { PtyHost, type PtySpawner } from '../services/PtyHost'

const socketPath = process.env['METSUKE_PTY_SOCKET']
const token = process.env['METSUKE_PTY_TOKEN']

if (!socketPath || !token) {
  console.error('metsuke pty host must be launched by the editor')
  process.exit(1)
}

/** The user's login shell, or a sane fallback per platform. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'powershell.exe'
  return process.env['SHELL'] ?? '/bin/zsh'
}

const spawner: PtySpawner = (opts, env) => {
  const command = opts.command ?? defaultShell()
  const cwd = opts.cwd ?? os.homedir()

  const proc = pty.spawn(command, opts.args ?? [], {
    name: 'xterm-256color',
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      ...env,
      // Tells `claude` and other TUIs they are talking to a capable terminal.
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Lets tools detect they are embedded, the way VS Code advertises itself.
      TERM_PROGRAM: 'metsuke'
    }
  })

  return { pty: proc, command, cwd }
}

const host = new PtyHost(spawner, token)

host.onIdle(() => {
  host.close()
  process.exit(0)
})

// Nothing here should ever take the host down while it holds somebody's session: the
// whole point is that it survives things the editor does not.
process.on('uncaughtException', (error) => console.error('[pty-host]', error))
process.on('unhandledRejection', (reason) => console.error('[pty-host]', reason))

host.listen(socketPath).catch((error) => {
  console.error('[pty-host] could not listen:', error)
  process.exit(1)
})
