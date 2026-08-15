import { webContents, type WebContents } from 'electron'
import type { ConsoleMessage, NetworkRequest } from '@shared/ipc'
import { withTimeout } from './withTimeout'

/** Console and network history are ring buffers; old entries fall off the back. */
const MAX_CONSOLE = 2000
const MAX_NETWORK = 1000

/** How long any single CDP command may take before it is called stuck. */
const CDP_TIMEOUT_MS = 15_000

/** A handle to one element from a snapshot, e.g. "e12". */
export type ElementRef = string

export interface SnapshotNode {
  ref: ElementRef
  role: string
  name: string
  value?: string
  /** Present only when the node is disabled, checked, expanded, etc. */
  state?: Record<string, string | boolean>
  children: SnapshotNode[]
}

export interface Target {
  /** Element handle from a previous snapshot. */
  ref?: ElementRef
  /** CSS selector, resolved fresh at call time. */
  selector?: string
  /** Absolute viewport coordinates. */
  x?: number
  y?: number
}

export class AutomationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationError'
  }
}

/** What the user picked when clicking an element in the preview. */
export interface PickedElement {
  /** CSS selector that resolves to this element, computed in the page. */
  selector: string
  tag: string
  id: string | null
  classes: string[]
  /** Visible text, trimmed and truncated. */
  text: string
  /** Opening tag only — enough to recognise the element without a wall of markup. */
  html: string
  rect: { x: number; y: number; width: number; height: number }
}

/**
 * Builds a selector for the picked element, in the page.
 *
 * Walks up ancestors accumulating tag + stable classes, stopping early at an id.
 * Framework-generated hashed class names (emotion, styled-components, Angular) are
 * skipped: they change between builds, so a selector containing them is worthless to
 * anyone reading it later.
 */
const DESCRIBE_FN = `function () {
  const el = this
  const stableClasses = (node) =>
    [...node.classList].filter((c) => !/^(css-|sc-|ng-|_|emotion-)/.test(c) && !/[0-9a-f]{6,}/.test(c))

  const part = (node) => {
    if (node.id) return '#' + CSS.escape(node.id)
    let out = node.tagName.toLowerCase()
    const cls = stableClasses(node).slice(0, 2)
    if (cls.length) out += '.' + cls.map((c) => CSS.escape(c)).join('.')
    const parent = node.parentElement
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName)
      if (sameTag.length > 1) out += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')'
    }
    return out
  }

  const parts = []
  let node = el
  while (node && node.nodeType === 1 && node.tagName !== 'BODY' && parts.length < 6) {
    const p = part(node)
    parts.unshift(p)
    if (p.startsWith('#')) break
    node = node.parentElement
  }

  const rect = el.getBoundingClientRect()
  const open = el.outerHTML.slice(0, el.outerHTML.indexOf('>') + 1)
  return {
    selector: parts.join(' > '),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: [...el.classList],
    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200),
    html: open.slice(0, 300),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
}`

/**
 * Reads everything about the current screen that matters for testing a flow: what page
 * this is, what you could interact with, what is filled in, and what the app is
 * complaining about.
 *
 * One round trip rather than a dozen, because an agent walking twenty screens will
 * otherwise spend its context on plumbing.
 */
const PAGE_STATE_FN = `(function () {
  const stable = (node) =>
    [...node.classList].filter((c) => !/^(css-|sc-|ng-|_|emotion-)/.test(c) && !/[0-9a-f]{6,}/.test(c))

  const selectorFor = (el) => {
    const part = (node) => {
      if (node.id) return '#' + CSS.escape(node.id)
      let out = node.tagName.toLowerCase()
      const cls = stable(node).slice(0, 2)
      if (cls.length) out += '.' + cls.map((c) => CSS.escape(c)).join('.')
      const parent = node.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName)
        if (same.length > 1) out += ':nth-of-type(' + (same.indexOf(node) + 1) + ')'
      }
      return out
    }
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && parts.length < 6) {
      const p = part(node)
      parts.unshift(p)
      if (p.startsWith('#')) break
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }

  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120)

  // A field's label is whatever a person would call it: <label for>, wrapping label,
  // aria-label, aria-labelledby, then placeholder or name as a fallback.
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l) return text(l)
    }
    const wrap = el.closest('label')
    if (wrap) return text(wrap)
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const l = document.getElementById(by)
      if (l) return text(l)
    }
    return el.placeholder || el.name || ''
  }

  const fieldOf = (el) => ({
    label: labelFor(el),
    name: el.name || null,
    type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text',
    selector: selectorFor(el),
    // Never report what is actually in a password box.
    value: el.type === 'password' ? (el.value ? '(set)' : '') : String(el.value ?? '').slice(0, 120),
    checked: el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined,
    required: !!el.required,
    disabled: !!el.disabled,
    invalid: el.getAttribute('aria-invalid') === 'true' || (el.checkValidity && !el.checkValidity()),
    options:
      el.tagName === 'SELECT' ? [...el.options].slice(0, 25).map((o) => o.value || o.text) : undefined
  })

  const controls = [...document.querySelectorAll('input, select, textarea')].filter(visible)
  const inForm = new Set()

  const forms = [...document.querySelectorAll('form')].filter(visible).slice(0, 10).map((f) => {
    const fields = [...f.querySelectorAll('input, select, textarea')].filter(visible)
    fields.forEach((x) => inForm.add(x))
    const submit = f.querySelector('button[type=submit], input[type=submit], button:not([type])')
    return {
      selector: selectorFor(f),
      name: f.getAttribute('name') || f.getAttribute('id') || null,
      action: f.getAttribute('action') || null,
      fields: fields.slice(0, 40).map(fieldOf),
      submit: submit ? { text: text(submit) || 'Submit', selector: selectorFor(submit) } : null
    }
  })

  const loose = controls.filter((c) => !inForm.has(c)).slice(0, 40).map(fieldOf)

  const buttons = [...document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')]
    .filter(visible)
    .slice(0, 60)
    .map((b) => ({ text: text(b) || b.value || '(no label)', selector: selectorFor(b), disabled: !!b.disabled }))

  const links = [...document.querySelectorAll('a[href]')]
    .filter(visible)
    .map((a) => ({ text: text(a), href: a.href, selector: selectorFor(a) }))
    .filter((l) => !l.href.startsWith('javascript:'))
    .slice(0, 80)

  const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]')]
    .filter(visible)
    .slice(0, 5)
    .map((d) => ({ selector: selectorFor(d), text: text(d) }))

  // What the app is telling the user is wrong, which is the thing a flow test is
  // usually looking for.
  const messages = [...document.querySelectorAll('[role=alert], [role=status], [aria-invalid=true], .error, .invalid, .form-error, .help-block')]
    .filter(visible)
    .slice(0, 20)
    .map((e) => ({ selector: selectorFor(e), text: text(e) }))
    .filter((m) => m.text)

  const headings = [...document.querySelectorAll('h1, h2, h3')].filter(visible).slice(0, 15).map(text)

  return {
    url: location.href,
    path: location.pathname + location.search + location.hash,
    title: document.title,
    headings,
    visibleText: (document.body ? document.body.innerText : '').trim().replace(/\\s+/g, ' ').slice(0, 1500),
    forms,
    fields: loose,
    buttons,
    links,
    dialogs,
    messages,
    counts: { forms: forms.length, buttons: buttons.length, links: links.length }
  }
})()`

/**
 * Full Chrome DevTools Protocol control over the preview webview.
 *
 * This is deliberately unrestricted: no per-action consent, no allowlist, no
 * confirmation prompts. That is safe here precisely because of what the preview is —
 * a dedicated webview in its own session partition with an empty cookie jar, pointed
 * at the user's local dev servers. It is not the user's browser, holds none of their
 * logins, and cannot reach the editor, the filesystem, or the main process.
 *
 * Input is synthesised through CDP's `Input` domain rather than JavaScript, so events
 * carry `isTrusted` and drive real event handlers, focus, and native form behaviour —
 * a `.click()` from `Runtime.evaluate` does not.
 */
export class AutomationService {
  #wc: WebContents | null = null
  #console: ConsoleMessage[] = []
  #network = new Map<string, NetworkRequest>()
  #order: string[] = []
  #onConsole: ((m: ConsoleMessage) => void) | null = null
  #onNavigate: ((url: string) => void) | null = null

  #onPick: ((element: PickedElement) => void) | null = null

  listen(handlers: {
    onConsole?: (m: ConsoleMessage) => void
    onNavigate?: (url: string) => void
    onPick?: (element: PickedElement) => void
  }): void {
    this.#onConsole = handlers.onConsole ?? null
    this.#onNavigate = handlers.onNavigate ?? null
    this.#onPick = handlers.onPick ?? null
  }

  /**
   * Turn on Chromium's own element picker in the preview: hovering highlights, clicking
   * selects. This is the inspector's crosshair, so the highlight and hit-testing are
   * exactly what devtools does rather than an overlay we would have to maintain.
   */
  async startInspect(): Promise<void> {
    await this.#send('DOM.enable').catch(() => {})
    await this.#send('Overlay.enable').catch(() => {})
    await this.#send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: {
        showInfo: true,
        contentColor: { r: 10, g: 132, b: 255, a: 0.3 },
        paddingColor: { r: 78, g: 201, b: 176, a: 0.25 },
        marginColor: { r: 226, g: 192, b: 141, a: 0.25 }
      }
    })
  }

  async stopInspect(): Promise<void> {
    await this.#send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => {})
    await this.#send('Overlay.hideHighlight').catch(() => {})
  }

  /** Resolve a picked node into something worth showing a human. */
  async #describe(backendNodeId: number): Promise<PickedElement> {
    const { object } = await this.#send<{ object: { objectId: string } }>('DOM.resolveNode', {
      backendNodeId
    })
    const result = await this.#send<any>('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: DESCRIBE_FN,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new AutomationError(result.exceptionDetails.exception?.description ?? 'Could not read element')
    }
    return result.result.value as PickedElement
  }

  get attached(): boolean {
    return this.#wc !== null && !this.#wc.isDestroyed() && this.#wc.debugger.isAttached()
  }

  #target(): WebContents {
    if (!this.#wc || this.#wc.isDestroyed()) {
      throw new AutomationError('Preview is not open. Open the preview panel first.')
    }
    if (!this.#wc.debugger.isAttached()) {
      throw new AutomationError('Preview debugger detached. Reload the preview to reconnect.')
    }
    return this.#wc
  }

  /** Resolvers waiting for the preview pane to come up. See waitForAttach. */
  #attachWaiters: Array<(attached: boolean) => void> = []

  /**
   * Wait for the preview to register, for callers that just asked the UI to open it.
   *
   * Opening the pane is a round trip through the renderer, a webview mount and a CDP
   * attach, so the tool that asked for it has to wait rather than fail on the state it
   * saw a millisecond earlier. Resolves false on timeout, which the caller answers by
   * failing the normal way with the normal explanation.
   */
  waitForAttach(timeoutMs = 5_000): Promise<boolean> {
    if (this.attached) return Promise.resolve(true)

    return new Promise<boolean>((resolve) => {
      const settle = (attached: boolean): void => {
        clearTimeout(timer)
        this.#attachWaiters = this.#attachWaiters.filter((w) => w !== settle)
        resolve(attached)
      }
      const timer = setTimeout(() => settle(false), timeoutMs)
      this.#attachWaiters.push(settle)
    })
  }

  /**
   * Attach to the preview's webContents. Called once when the preview mounts; a
   * reload of the preview re-registers with a new id.
   */
  attach(webContentsId: number): void {
    const wc = webContents.fromId(webContentsId)
    if (!wc) throw new AutomationError(`No webContents with id ${webContentsId}`)

    if (this.#wc && !this.#wc.isDestroyed() && this.#wc !== wc) this.detach()
    this.#wc = wc

    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    wc.debugger.on('message', (_e, method, params) => this.#onCdpEvent(method, params))
    wc.once('destroyed', () => {
      this.#wc = null
    })

    // Fire and forget: a domain that fails to enable should not block the others.
    for (const domain of ['Page', 'DOM', 'Runtime', 'Network', 'Log']) {
      void wc.debugger.sendCommand(`${domain}.enable`).catch(() => {})
    }

    for (const waiter of [...this.#attachWaiters]) waiter(true)
  }

  detach(): void {
    if (this.#wc && !this.#wc.isDestroyed() && this.#wc.debugger.isAttached()) {
      this.#wc.debugger.detach()
    }
    this.#wc = null
  }

  /*
   * Every CDP call goes through one deadline.
   *
   * sendCommand has none of its own, so a command Chromium never acks leaves the bridge
   * request pending and the tool call appears to return nothing at all. Fifteen seconds
   * is well past any healthy call, including a full-page screenshot, and a failure that
   * names the method is something an agent can act on, which is the actual difference.
   */
  async #send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await withTimeout(
      this.#target().debugger.sendCommand(method, params),
      CDP_TIMEOUT_MS,
      method
    )) as T
  }

  // -------------------------------------------------------------------------
  // Event capture
  // -------------------------------------------------------------------------

  #onCdpEvent(method: string, params: any): void {
    switch (method) {
      case 'Runtime.consoleAPICalled':
        this.#pushConsole({
          level: params.type === 'warning' ? 'warning' : mapConsoleLevel(params.type),
          text: (params.args ?? []).map(stringifyRemoteObject).join(' '),
          url: params.stackTrace?.callFrames?.[0]?.url ?? null,
          line: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
          timestamp: Date.now()
        })
        break

      case 'Runtime.exceptionThrown': {
        const d = params.exceptionDetails
        this.#pushConsole({
          level: 'error',
          text: d?.exception?.description ?? d?.text ?? 'Uncaught exception',
          url: d?.url ?? null,
          line: d?.lineNumber ?? null,
          timestamp: Date.now()
        })
        break
      }

      // Network errors, CSP violations, and deprecations arrive here rather than
      // through the console API, and they are exactly what a UI test needs to see.
      case 'Log.entryAdded':
        this.#pushConsole({
          level: mapConsoleLevel(params.entry?.level),
          text: params.entry?.text ?? '',
          url: params.entry?.url ?? null,
          line: params.entry?.lineNumber ?? null,
          timestamp: Date.now()
        })
        break

      case 'Network.requestWillBeSent':
        this.#recordRequest({
          requestId: params.requestId,
          url: params.request?.url ?? '',
          method: params.request?.method ?? 'GET',
          status: null,
          statusText: null,
          duration: null,
          failed: false,
          errorText: null,
          timestamp: Date.now()
        })
        break

      case 'Network.responseReceived': {
        const req = this.#network.get(params.requestId)
        if (req) {
          req.status = params.response?.status ?? null
          req.statusText = params.response?.statusText ?? null
        }
        break
      }

      case 'Network.loadingFinished': {
        const req = this.#network.get(params.requestId)
        if (req) req.duration = Date.now() - req.timestamp
        break
      }

      case 'Network.loadingFailed': {
        const req = this.#network.get(params.requestId)
        if (req) {
          req.failed = true
          req.errorText = params.errorText ?? 'Request failed'
          req.duration = Date.now() - req.timestamp
        }
        break
      }

      case 'Page.frameNavigated':
        if (!params.frame?.parentId) this.#onNavigate?.(params.frame?.url ?? '')
        break

      // The user clicked an element while the picker was active. Chromium leaves inspect
      // mode by itself at this point, so the renderer is told to untoggle too.
      case 'Overlay.inspectNodeRequested':
        void this.#describe(params.backendNodeId)
          .then((element) => this.#onPick?.(element))
          .catch(() => {})
          .finally(() => void this.stopInspect())
        break
    }
  }

  #pushConsole(message: ConsoleMessage): void {
    this.#console.push(message)
    if (this.#console.length > MAX_CONSOLE) this.#console.shift()
    this.#onConsole?.(message)
  }

  #recordRequest(req: NetworkRequest): void {
    this.#network.set(req.requestId, req)
    this.#order.push(req.requestId)
    while (this.#order.length > MAX_NETWORK) {
      const evicted = this.#order.shift()
      if (evicted) this.#network.delete(evicted)
    }
  }

  /** Buffered console messages, oldest first, optionally filtered by regex. */
  consoleMessages(opts: { pattern?: string; limit?: number } = {}): ConsoleMessage[] {
    const { pattern, limit = 200 } = opts
    let messages = this.#console
    if (pattern) {
      const re = new RegExp(pattern, 'i')
      messages = messages.filter((m) => re.test(m.text))
    }
    return messages.slice(-limit)
  }

  networkRequests(opts: { limit?: number } = {}): NetworkRequest[] {
    const { limit = 100 } = opts
    return this.#order
      .map((id) => this.#network.get(id))
      .filter((r): r is NetworkRequest => r !== undefined)
      .slice(-limit)
  }

  clearBuffers(): void {
    this.#console = []
    this.#network.clear()
    this.#order = []
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  async navigate(url: string): Promise<void> {
    const wc = this.#target()
    // Bare "3000" or "localhost:3000" are what a dev actually types.
    const normalised = /^https?:\/\//.test(url)
      ? url
      : /^\d+$/.test(url)
        ? `http://localhost:${url}`
        : `http://${url}`
    await wc.loadURL(normalised)
  }

  async reload(): Promise<void> {
    this.#target().reload()
  }

  // -------------------------------------------------------------------------
  // Inspection
  // -------------------------------------------------------------------------

  /**
   * An accessibility-tree snapshot: the page as assistive technology sees it, which
   * is a far better basis for automation than raw DOM. Every interactive node gets a
   * stable `ref` usable with click/type until the next navigation.
   */
  async snapshot(opts: { interestingOnly?: boolean } = {}): Promise<SnapshotNode[]> {
    await this.#send('Accessibility.enable').catch(() => {})
    const { nodes } = await this.#send<{ nodes: any[] }>('Accessibility.getFullAXTree')

    const byId = new Map<string, any>(nodes.map((n) => [n.nodeId, n]))
    this.#refs.clear()

    let counter = 0
    const build = (node: any): SnapshotNode | null => {
      if (!node || node.ignored) return null

      const role = node.role?.value ?? 'generic'
      const name = node.name?.value ?? ''
      const children = (node.childIds ?? [])
        .map((id: string) => byId.get(id))
        .map(build)
        .filter((c: SnapshotNode | null): c is SnapshotNode => c !== null)

      // Structural wrappers with no name and one child add noise without information.
      if (opts.interestingOnly !== false && role === 'generic' && !name && children.length === 1) {
        return children[0]
      }

      const ref = `e${++counter}`
      if (node.backendDOMNodeId !== undefined) this.#refs.set(ref, node.backendDOMNodeId)

      const state: Record<string, string | boolean> = {}
      for (const p of node.properties ?? []) {
        if (['disabled', 'checked', 'expanded', 'focused', 'required', 'selected'].includes(p.name)) {
          state[p.name] = p.value?.value
        }
      }

      return {
        ref,
        role,
        name,
        value: node.value?.value,
        ...(Object.keys(state).length > 0 ? { state } : {}),
        children
      }
    }

    const roots = nodes.filter((n) => !nodes.some((m) => (m.childIds ?? []).includes(n.nodeId)))
    return roots.map(build).filter((n): n is SnapshotNode => n !== null)
  }

  readonly #refs = new Map<ElementRef, number>()

  /** PNG bytes of the viewport, or of a single element when a target is given. */
  async screenshot(target?: Target): Promise<Buffer> {
    if (target && (target.ref || target.selector)) {
      const backendNodeId = await this.#resolve(target)
      const { model } = await this.#send<{ model: any }>('DOM.getBoxModel', { backendNodeId })
      const [x1, y1, , , x3, y3] = model.border
      const { data } = await this.#send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        clip: { x: x1, y: y1, width: x3 - x1, height: y3 - y1, scale: 1 },
        captureBeyondViewport: true
      })
      return Buffer.from(data, 'base64')
    }

    const { data } = await this.#send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(data, 'base64')
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.#send<any>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    })
    if (result.exceptionDetails) {
      throw new AutomationError(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      )
    }
    return result.result?.value
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /** Turn a Target into a CDP backendNodeId. */
  async #resolve(target: Target): Promise<number> {
    if (target.ref) {
      const id = this.#refs.get(target.ref)
      if (id === undefined) {
        throw new AutomationError(
          `Unknown element ref "${target.ref}". Take a fresh snapshot — refs are invalidated by navigation.`
        )
      }
      return id
    }

    if (target.selector) {
      const { root } = await this.#send<{ root: any }>('DOM.getDocument', { depth: -1 })
      const { nodeId } = await this.#send<{ nodeId: number }>('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: target.selector
      })
      if (!nodeId) throw new AutomationError(`No element matches selector: ${target.selector}`)
      const { node } = await this.#send<{ node: any }>('DOM.describeNode', { nodeId })
      return node.backendNodeId
    }

    throw new AutomationError('Target needs a ref, a selector, or x/y coordinates')
  }

  /** Viewport centre point of a target, scrolling it into view first. */
  async #centre(target: Target): Promise<{ x: number; y: number }> {
    if (target.x !== undefined && target.y !== undefined) return { x: target.x, y: target.y }

    const backendNodeId = await this.#resolve(target)
    await this.#send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})

    const { model } = await this.#send<{ model: any }>('DOM.getBoxModel', { backendNodeId })
    const q = model.content
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 }
  }

  async click(target: Target, opts: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    const { x, y } = await this.#centre(target)
    const button = opts.button ?? 'left'
    const clickCount = opts.clickCount ?? 1
    const base = { x, y, button, clickCount, buttons: button === 'left' ? 1 : 2 }

    await this.#send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 })
    await this.#send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
    await this.#send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
  }

  /**
   * Type into a target. Uses `Input.insertText` for the body of the string, which is
   * fast and handles non-ASCII, then dispatches real key events for the last character
   * so frameworks listening for keydown/keyup still fire.
   */
  async type(target: Target | null, text: string, opts: { clear?: boolean } = {}): Promise<void> {
    if (target) {
      await this.click(target)
      if (opts.clear) {
        /*
         * Select-all via the `commands` field rather than a synthetic Cmd/Ctrl+A.
         *
         * A plain modified key event does not clear the field: Chromium routes that
         * shortcut through the native menu layer, which a synthesised event never
         * reaches, so the selection never happened and the new text was appended to the
         * old — "ada@example.com" + "not-an-email". `commands` asks the editor to run
         * the editing command directly, which works regardless of platform.
         */
        const selectAll = {
          key: 'a',
          code: 'KeyA',
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
          modifiers: process.platform === 'darwin' ? 4 : 2 // Meta on macOS, Control elsewhere
        }
        await this.#send('Input.dispatchKeyEvent', {
          ...selectAll,
          type: 'keyDown',
          commands: ['selectAll']
        })
        await this.#send('Input.dispatchKeyEvent', { ...selectAll, type: 'keyUp' })
      }
    }

    // insertText replaces the current selection, so an empty string still clears.
    if (opts.clear && !text) {
      await this.#send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Delete',
        code: 'Delete',
        windowsVirtualKeyCode: 46,
        commands: ['deleteBackward']
      })
      await this.#send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete' })
    }
    if (text) await this.#send('Input.insertText', { text })
  }

  /** Press a named key, e.g. "Enter", "Tab", "Escape", "ArrowDown". */
  async press(key: string): Promise<void> {
    const def = KEYS[key] ?? { key, code: key, keyCode: key.length === 1 ? key.charCodeAt(0) : 0 }
    const payload = {
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode
    }
    await this.#send('Input.dispatchKeyEvent', { ...payload, type: 'rawKeyDown' })
    if (def.text) await this.#send('Input.dispatchKeyEvent', { ...payload, type: 'char', text: def.text })
    await this.#send('Input.dispatchKeyEvent', { ...payload, type: 'keyUp' })
  }

  async scroll(deltaX: number, deltaY: number, at?: Target): Promise<void> {
    const { x, y } = at ? await this.#centre(at) : { x: 400, y: 300 }
    await this.#send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX,
      deltaY
    })
  }

  // -------------------------------------------------------------------------
  // Screen state and form filling
  // -------------------------------------------------------------------------

  /**
   * Everything about the current screen, plus the console errors and failed requests
   * recorded since the last navigation. This is the "what am I looking at" call.
   */
  async pageState(): Promise<Record<string, unknown>> {
    const state = (await this.evaluate(PAGE_STATE_FN)) as Record<string, unknown>
    return {
      ...state,
      consoleErrors: this.consoleMessages({ limit: 25 })
        .filter((m) => m.level === 'error' || m.level === 'warning')
        .map((m) => `${m.level}: ${m.text}`.slice(0, 300)),
      failedRequests: this.networkRequests({ limit: 60 })
        .filter((r) => r.failed || (r.status !== null && r.status >= 400))
        .slice(-15)
        .map((r) => `${r.method} ${r.url} → ${r.failed ? r.errorText : r.status}`.slice(0, 300))
    }
  }

  /**
   * Enter values into fields, choosing the right mechanism per control type.
   *
   * Text goes in as real typed input so frameworks with controlled components see the
   * events they expect; checkboxes and radios are clicked only when the state actually
   * needs to change; selects are set directly, since a native dropdown has no page-level
   * UI to drive.
   */
  async fill(
    fields: Array<{ selector: string; value: string }>
  ): Promise<Array<{ selector: string; ok: boolean; error?: string }>> {
    const results: Array<{ selector: string; ok: boolean; error?: string }> = []

    for (const field of fields) {
      const quoted = JSON.stringify(field.selector)
      try {
        const kind = await this.evaluate(
          `(() => { const e = document.querySelector(${quoted});
             if (!e) return 'missing';
             if (e.tagName === 'SELECT') return 'select';
             const t = (e.type || '').toLowerCase();
             return t === 'checkbox' || t === 'radio' ? t : 'text'; })()`
        )

        if (kind === 'missing') throw new AutomationError(`No element matches ${field.selector}`)

        if (kind === 'select') {
          const chosen = await this.evaluate(
            `(() => { const e = document.querySelector(${quoted});
               const want = ${JSON.stringify(field.value)};
               const opt = [...e.options].find(o => o.value === want || o.text === want)
                 ?? [...e.options].find(o => o.text.toLowerCase().includes(want.toLowerCase()));
               if (!opt) return false;
               e.value = opt.value;
               e.dispatchEvent(new Event('input', { bubbles: true }));
               e.dispatchEvent(new Event('change', { bubbles: true }));
               return true; })()`
          )
          if (!chosen) throw new AutomationError(`No option matching "${field.value}"`)
        } else if (kind === 'checkbox' || kind === 'radio') {
          const want = /^(true|1|yes|on|check(ed)?)$/i.test(field.value.trim())
          const isChecked = await this.evaluate(
            `!!document.querySelector(${quoted}).checked`
          )
          if (Boolean(isChecked) !== want) await this.click({ selector: field.selector })
        } else {
          await this.type({ selector: field.selector }, field.value, { clear: true })
        }

        results.push({ selector: field.selector, ok: true })
      } catch (e) {
        // One bad field must not abandon the rest — the caller wants to know which of
        // twenty inputs failed, not just that something did.
        results.push({
          selector: field.selector,
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }

    return results
  }

  // -------------------------------------------------------------------------
  // Waiting
  // -------------------------------------------------------------------------

  /**
   * Poll until a condition holds. Every UI test needs this, and polling from the main
   * process beats asking the model to sleep and retry.
   */
  async waitFor(
    condition: { selector?: string; text?: string; gone?: boolean },
    opts: { timeoutMs?: number } = {}
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 10_000
    const deadline = Date.now() + timeoutMs
    const { selector, text, gone = false } = condition

    if (!selector && !text) throw new AutomationError('waitFor needs a selector or text')

    const expression = selector
      ? `!!document.querySelector(${JSON.stringify(selector)})`
      : `document.body && document.body.innerText.includes(${JSON.stringify(text)})`

    for (;;) {
      const present = Boolean(await this.evaluate(expression).catch(() => false))
      if (present !== gone) return
      if (Date.now() > deadline) {
        throw new AutomationError(
          `Timed out after ${timeoutMs}ms waiting for ${selector ?? `text ${JSON.stringify(text)}`} to ${gone ? 'disappear' : 'appear'}`
        )
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

function mapConsoleLevel(level: string | undefined): ConsoleMessage['level'] {
  switch (level) {
    case 'error':
      return 'error'
    case 'warning':
    case 'warn':
      return 'warning'
    case 'debug':
    case 'verbose':
      return 'debug'
    case 'info':
      return 'info'
    default:
      return 'log'
  }
}

/** Render a CDP RemoteObject the way a devtools console would. */
function stringifyRemoteObject(arg: any): string {
  if (arg == null) return String(arg)
  if ('value' in arg) return typeof arg.value === 'object' ? JSON.stringify(arg.value) : String(arg.value)
  if (arg.unserializableValue) return String(arg.unserializableValue)
  if (arg.description) return arg.description
  return arg.type ?? ''
}

/** Virtual key codes for the keys automation actually uses. */
const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9, text: '\t' },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' }
}
