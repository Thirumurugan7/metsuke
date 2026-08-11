/**
 * Screenshot the editor's own window over CDP. Node 22+ has a built-in WebSocket, so
 * this needs no dependencies.
 *
 * Usage: node shot.mjs <out.png>
 */
import { writeFileSync } from 'node:fs'

const out = process.argv[2] ?? 'ui.png'
const PORT = process.env.PORT ?? '9222'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const match = process.env.TARGET ?? ''
const page = targets.find((t) => (t.type === 'page' || t.type === 'webview') && !t.url.startsWith('devtools://') && (match ? t.url.includes(match) : t.type === 'page' && !t.url.includes('alert.html')))
if (!page) {
  console.error('No page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id
    pending.set(messageId, { resolve, reject })
    ws.send(JSON.stringify({ id: messageId, method, params }))
    setTimeout(() => {
      if (pending.delete(messageId)) reject(new Error(`${method} timed out`))
    }, 15000)
  })

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const waiter = msg.id && pending.get(msg.id)
  if (!waiter) return
  pending.delete(msg.id)
  msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result)
})

ws.addEventListener('open', async () => {
  try {
    // fromSurface:false renders off the renderer's own tree, so it works even when the
    // window is occluded or backgrounded and the compositor has stopped producing frames.
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: false })
    writeFileSync(out, Buffer.from(data, 'base64'))
    console.log(`wrote ${out}`)
  } catch (e) {
    console.error('failed:', e.message)
    process.exitCode = 1
  } finally {
    ws.close()
    process.exit(process.exitCode ?? 0)
  }
})

ws.addEventListener('error', () => {
  console.error('websocket error')
  process.exit(1)
})
