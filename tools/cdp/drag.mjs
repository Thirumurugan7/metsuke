/**
 * Perform a real mouse drag in the editor via CDP Input events.
 * Usage: node drag.mjs <x1> <y1> <x2> <y2> [steps]
 */
const [x1, y1, x2, y2, steps = '12'] = process.argv.slice(2).map(String)
const PORT = process.env.PORT ?? '9222'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
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
    }, 10000)
  })

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  const w = msg.id && pending.get(msg.id)
  if (!w) return
  pending.delete(msg.id)
  msg.error ? w.reject(new Error(JSON.stringify(msg.error))) : w.resolve(msg.result)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

ws.addEventListener('open', async () => {
  try {
    const ax = Number(x1)
    const ay = Number(y1)
    const bx = Number(x2)
    const by = Number(y2)
    const n = Number(steps)

    const base = { button: 'left', clickCount: 1, pointerType: 'mouse' }
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', x: ax, y: ay, buttons: 0 })
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', x: ax, y: ay, buttons: 1 })

    for (let i = 1; i <= n; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / n)
      const y = Math.round(ay + ((by - ay) * i) / n)
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', x, y, buttons: 1 })
      await sleep(16)
    }

    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', x: bx, y: by, buttons: 0 })
    // The CDP ack means "queued", not "the renderer handled it". Without a settle the
    // socket closes and the tail of the drag is lost, which looks like an app bug.
    await sleep(400)
    console.log('drag done')
  } catch (e) {
    console.error('failed:', e.message)
    process.exitCode = 1
  } finally {
    ws.close()
    process.exit(process.exitCode ?? 0)
  }
})

ws.addEventListener('error', () => process.exit(1))
