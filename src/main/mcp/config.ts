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
  /*
   * Hook commands run through the platform's shell, so the variable syntax and the
   * null device differ. On Windows this is cmd.exe (%VAR%, NUL); everywhere else it is
   * a POSIX shell ($VAR, /dev/null). Getting this wrong does not error — the hook just
   * posts to a nonsense URL and notifications silently never arrive.
   *
   * curl ships with Windows 10 1803+ and with macOS and every mainstream Linux.
   */
  const windows = process.platform === 'win32'
  const url = windows ? '%OPEN_CLAUDE_CONTROL_URL%' : '$OPEN_CLAUDE_CONTROL_URL'
  const token = windows ? '%OPEN_CLAUDE_CONTROL_TOKEN%' : '$OPEN_CLAUDE_CONTROL_TOKEN'
  const quiet = windows ? '>NUL 2>&1' : '>/dev/null 2>&1'

  /*
   * The trailing swallow matters more than it looks. A `PreToolUse` hook that exits
   * non-zero can block the tool it is watching, so a curl that cannot reach the editor
   * must never fail the command: an editor that is closing would otherwise start
   * interfering with Claude's ability to delegate.
   */
  const post = (kind: string): string =>
    `curl -sS -m 5 -X POST "${url}/notify?kind=${kind}" ` +
    `-H "authorization: Bearer ${token}" ` +
    `-H "content-type: application/json" --data-binary @- ${quiet}` +
    (windows ? ' & exit /b 0' : ' || true')

  const settings = {
    hooks: {
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: post('notification') }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: post('stop') }] }],
      /*
       * The thread list is built from these three rather than from the terminal stream.
       *
       * A `Task` call is Claude delegating to a subagent, so PreToolUse and PostToolUse
       * matched to it bracket the subagent's whole life, and their payloads carry the
       * description, the agent type and the returned report. Reading lifecycle from
       * hooks means the sidebar also sees subagents Claude decided to spawn on its own,
       * which parsing our own UI actions never would.
       *
       * UserPromptSubmit is what flips a thread from idle back to running the moment you
       * hit enter, instead of a second or two later when output starts arriving.
       */
      PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: post('subagent-start') }] }],
      PostToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: post('subagent-stop') }] }],
      UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: post('prompt') }] }]
    },
    /*
     * Claude reaches for the Chrome extension by default, which drives the user's own
     * browser in a separate window — the editor's preview then sits there showing
     * nothing, and none of the console, network, or screenshot output lands in the pane
     * you are looking at. Denying those tools inside this session leaves preview_* as
     * the way to drive a browser, which is the whole point of the preview pane.
     *
     * This applies only to sessions started by the editor; your own `claude` in a normal
     * terminal is untouched.
     */
    permissions: {
      deny: ['mcp__claude-in-chrome']
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
