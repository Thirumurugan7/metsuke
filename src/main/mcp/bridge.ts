import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { AddressInfo } from 'node:net'
import type { AutomationService, Target } from '../services/AutomationService'

/**
 * A loopback control channel between the MCP server process and this one.
 *
 * The MCP server that Claude Code talks to is a separate stdio process, but the
 * webview it needs to drive lives here in Electron's main process. This bridge is the
 * seam: a tiny HTTP server bound to 127.0.0.1 on an ephemeral port, protected by a
 * per-run bearer token. Both the port and the token are handed to the MCP process
 * through its environment, so nothing else on the machine can reach it.
 */
export class ControlBridge {
  readonly #automation: AutomationService
  readonly #token = randomBytes(32).toString('hex')
  #server: http.Server | null = null
  #port = 0
  #onHook: ((kind: string, body: string) => Promise<void>) | null = null

  constructor(automation: AutomationService) {
    this.#automation = automation
  }

  get port(): number {
    return this.#port
  }

  get token(): string {
    return this.#token
  }

  async start(): Promise<void> {
    this.#server = http.createServer((req, res) => void this.#onRequest(req, res))
    await new Promise<void>((resolve, reject) => {
      this.#server!.once('error', reject)
      // Port 0 lets the OS pick; 127.0.0.1 keeps it off every external interface.
      this.#server!.listen(0, '127.0.0.1', () => {
        this.#port = (this.#server!.address() as AddressInfo).port
        resolve()
      })
    })
  }

  async #onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(payload)
    }

    if (req.headers.authorization !== `Bearer ${this.#token}`) return send(401, { error: 'Unauthorized' })
    if (req.method !== 'POST') return send(404, { error: 'Not found' })

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    let raw = ''
    for await (const chunk of req) raw += chunk

    // Claude Code's hooks POST here. The body is the hook's own stdin payload.
    if (url.pathname === '/notify') {
      try {
        await this.#onHook?.(url.searchParams.get('kind') ?? 'notification', raw)
      } catch {
        // A failed notification must never break the hook, which would stall Claude.
      }
      return send(200, { ok: true })
    }

    if (url.pathname !== '/call') return send(404, { error: 'Not found' })

    let call: { tool: string; args: Record<string, any> }
    try {
      call = JSON.parse(raw)
    } catch {
      return send(400, { error: 'Malformed JSON body' })
    }

    try {
      send(200, { result: await this.#dispatch(call.tool, call.args ?? {}) })
    } catch (e) {
      send(200, { error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Called for every Claude Code hook delivery, with the raw JSON body. */
  onHook(handler: (kind: string, body: string) => Promise<void>): void {
    this.#onHook = handler
  }

  /** Map a tool name onto AutomationService. The MCP layer owns schemas; this owns behaviour. */
  async #dispatch(tool: string, args: Record<string, any>): Promise<unknown> {
    const a = this.#automation
    const target = (): Target => ({ ref: args.ref, selector: args.selector, x: args.x, y: args.y })

    switch (tool) {
      case 'preview_navigate':
        await a.navigate(String(args.url))
        return { url: args.url }

      case 'preview_reload':
        await a.reload()
        return { ok: true }

      case 'preview_snapshot':
        return a.snapshot()

      case 'preview_screenshot': {
        const png = await a.screenshot(args.ref || args.selector ? target() : undefined)
        return { mimeType: 'image/png', base64: png.toString('base64') }
      }

      case 'preview_click':
        await a.click(target(), { button: args.button, clickCount: args.doubleClick ? 2 : 1 })
        return { ok: true }

      case 'preview_type':
        await a.type(args.ref || args.selector ? target() : null, String(args.text ?? ''), {
          clear: Boolean(args.clear)
        })
        if (args.submit) await a.press('Enter')
        return { ok: true }

      case 'preview_press':
        await a.press(String(args.key))
        return { ok: true }

      case 'preview_scroll':
        await a.scroll(Number(args.deltaX ?? 0), Number(args.deltaY ?? 400), args.selector ? target() : undefined)
        return { ok: true }

      case 'preview_state':
        return a.pageState()

      case 'preview_fill':
        return { results: await a.fill(args.fields ?? []) }

      case 'preview_eval':
        return { value: await a.evaluate(String(args.expression)) }

      case 'preview_console':
        return a.consoleMessages({ pattern: args.pattern, limit: args.limit })

      case 'preview_network':
        return a.networkRequests({ limit: args.limit })

      case 'preview_wait_for':
        await a.waitFor(
          { selector: args.selector, text: args.text, gone: Boolean(args.gone) },
          { timeoutMs: args.timeoutMs }
        )
        return { ok: true }

      default:
        throw new Error(`Unknown tool: ${tool}`)
    }
  }

  stop(): void {
    this.#server?.close()
    this.#server = null
  }
}
