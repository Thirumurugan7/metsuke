/** Evaluate an expression in the editor's renderer over CDP. Usage: node eval.mjs '<expr>' */
const expression = process.argv[2]
const PORT = process.env.PORT ?? '9222'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const match = process.env.TARGET ?? ''
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://') && (match ? t.url.includes(match) : !t.url.includes('alert.html')))
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
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    console.log(JSON.stringify(r.exceptionDetails ?? r.result?.value ?? null, null, 2))
  } catch (e) {
    console.error('failed:', e.message)
    process.exitCode = 1
  } finally {
    ws.close()
    process.exit(process.exitCode ?? 0)
  }
})

ws.addEventListener('error', () => process.exit(1))
