/**
 * The MCP server Claude Code connects to.
 *
 * This runs as its own stdio process, spawned by `claude` in the embedded terminal. It
 * holds no state: every tool call is forwarded over the loopback control bridge to the
 * Electron main process, which owns the preview webview and its debugger session.
 *
 * The effect is that Claude gets `preview_click`, `preview_snapshot`, and friends as
 * native tools, and can drive the app it is building end to end without ever leaving
 * the editor.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const CONTROL_URL = process.env['CODEEDITOR_CONTROL_URL']
const CONTROL_TOKEN = process.env['CODEEDITOR_CONTROL_TOKEN']

if (!CONTROL_URL || !CONTROL_TOKEN) {
  console.error('codeeditor-mcp must be launched by the editor; control channel is not configured.')
  process.exit(1)
}

const TOOLS = [
  {
    name: 'preview_navigate',
    description:
      'Load a URL in the editor preview pane. Accepts a full URL, "localhost:3000", or a bare port number like "5173".',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL, host:port, or bare port' } },
      required: ['url']
    }
  },
  {
    name: 'preview_reload',
    description: 'Reload the current page in the preview pane.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'preview_snapshot',
    description:
      'Accessibility-tree snapshot of the preview page. Returns roles, names, and a stable "ref" for each node. Prefer this over a screenshot to find things to interact with: refs from here are what preview_click and preview_type take. Refs are invalidated by navigation, so re-snapshot after the page changes.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'preview_screenshot',
    description:
      'PNG screenshot of the preview viewport, or of a single element when ref or selector is given. Use for judging visual appearance; use preview_snapshot to find elements.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref from preview_snapshot' },
        selector: { type: 'string', description: 'CSS selector' }
      }
    }
  },
  {
    name: 'preview_click',
    description:
      'Click an element. Identify it by ref (from preview_snapshot), by CSS selector, or by absolute x/y viewport coordinates. Dispatches a real trusted mouse event, so handlers, focus, and native behaviour all fire.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        selector: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        doubleClick: { type: 'boolean' }
      }
    }
  },
  {
    name: 'preview_type',
    description:
      'Type text. With a ref or selector, focuses that element first; without one, types into whatever currently has focus. Set clear to replace the existing value, submit to press Enter afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        ref: { type: 'string' },
        selector: { type: 'string' },
        clear: { type: 'boolean' },
        submit: { type: 'boolean' }
      },
      required: ['text']
    }
  },
  {
    name: 'preview_press',
    description:
      'Press a single key, e.g. Enter, Tab, Escape, ArrowDown, Backspace. For text, use preview_type.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key']
    }
  },
  {
    name: 'preview_scroll',
    description: 'Scroll the page, or a specific element, by a pixel delta.',
    inputSchema: {
      type: 'object',
      properties: {
        deltaY: { type: 'number', description: 'Positive scrolls down. Defaults to 400.' },
        deltaX: { type: 'number' },
        selector: { type: 'string' }
      }
    }
  },
  {
    name: 'preview_eval',
    description:
      'Evaluate a JavaScript expression in the preview page and return its value. Awaits promises. Use for reading state that is not visible in the accessibility tree.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression']
    }
  },
  {
    name: 'preview_console',
    description:
      'Buffered console output from the preview, including uncaught exceptions, CSP violations, and failed resource loads. Filter with a case-insensitive regex pattern. Check this after any interaction to catch errors the UI does not show.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Case-insensitive regex filter' },
        limit: { type: 'number', description: 'Most recent N messages, default 200' }
      }
    }
  },
  {
    name: 'preview_network',
    description:
      'Recent network requests from the preview with method, status, duration, and failure reason. Use to confirm an API call fired and what it returned.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Most recent N requests, default 100' } }
    }
  },
  {
    name: 'preview_wait_for',
    description:
      'Block until a selector or text appears in the preview, or disappears when gone is true. Use after an action that triggers async work rather than guessing at a delay.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        gone: { type: 'boolean', description: 'Wait for absence instead of presence' },
        timeoutMs: { type: 'number', description: 'Default 10000' }
      }
    }
  }
] as const

async function callBridge(tool: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${CONTROL_URL}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CONTROL_TOKEN}` },
    body: JSON.stringify({ tool, args })
  })

  if (!response.ok) {
    throw new Error(`Editor control channel returned ${response.status}. Is the editor still running?`)
  }

  const body = (await response.json()) as { result?: unknown; error?: string }
  if (body.error) throw new Error(body.error)
  return body.result
}

const server = new Server(
  { name: 'codeeditor-preview', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const result = await callBridge(name, (args ?? {}) as Record<string, unknown>)

    // Screenshots come back as base64 and must be returned as an image content block
    // so the model actually sees the picture rather than a wall of base64.
    if (result && typeof result === 'object' && 'base64' in result) {
      return {
        content: [{ type: 'image', data: result.base64, mimeType: result.mimeType ?? 'image/png' }]
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (e) {
    // Reported as a tool error rather than a protocol error, so Claude can read the
    // message and adjust instead of the whole call failing opaquely.
    return {
      content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
      isError: true
    }
  }
})

await server.connect(new StdioServerTransport())
