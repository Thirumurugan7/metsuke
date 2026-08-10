import { app } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ControlBridge } from './bridge'

/**
 * Settings handed to the embedded `claude` via --settings, wiring its hooks back to the
 * editor's control bridge.
 *
 * Hooks are how the editor knows Claude wants something. Claude Code fires
 * `Notification` when it needs permission to run a tool or has been idle waiting on
 * you, and `Stop` when it finishes a turn. Each hook receives its JSON payload on
 * stdin, which the command below forwards verbatim.
 *
 * The URL and token come from the environment rather than being baked into the file:
 * the pty that runs `claude` carries them (see TerminalService), so the token never
 * lands on disk in the settings.
 */
export async function writeHookSettings(): Promise<string> {
  const post = (kind: string): string =>
    `curl -sS -m 5 -X POST "$OPEN_CLAUDE_CONTROL_URL/notify?kind=${kind}" ` +
    `-H "authorization: Bearer $OPEN_CLAUDE_CONTROL_TOKEN" ` +
    `-H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 || true`

  const settings = {
    hooks: {
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: post('notification') }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: post('stop') }] }]
    }
  }

  const settingsPath = path.join(app.getPath('userData'), 'claude-hooks.json')
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  return settingsPath
}

/**
 * Writes the MCP config that the embedded `claude` is launched with.
 *
 * It lives in the app's own data directory rather than in the user's repo, so opening
 * a folder never adds an untracked file or collides with a project's existing
 * `.mcp.json`. The control token is regenerated per app run, so the file is rewritten
 * on every launch.
 */
export async function writeMcpConfig(bridge: ControlBridge): Promise<string> {
  const dirname = path.dirname(fileURLToPath(import.meta.url))
  const serverEntry = path.join(dirname, 'mcp-server.js')

  const config = {
    mcpServers: {
      preview: {
        command: process.execPath,
        args: [serverEntry],
        env: {
          OPEN_CLAUDE_CONTROL_URL: `http://127.0.0.1:${bridge.port}`,
          OPEN_CLAUDE_CONTROL_TOKEN: bridge.token,
          // Electron's binary runs as a browser unless told to behave as plain Node.
          ELECTRON_RUN_AS_NODE: '1'
        }
      }
    }
  }

  const configPath = path.join(app.getPath('userData'), 'mcp-preview.json')
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
  return configPath
}
