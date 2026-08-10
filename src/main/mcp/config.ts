import { app } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ControlBridge } from './bridge'

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
          CODEEDITOR_CONTROL_URL: `http://127.0.0.1:${bridge.port}`,
          CODEEDITOR_CONTROL_TOKEN: bridge.token,
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
