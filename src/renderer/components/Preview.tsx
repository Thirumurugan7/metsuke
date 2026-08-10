import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { PortsPanel } from './PortsPanel'

/**
 * React's types already cover the <webview> element and its Electron attributes; what
 * they do not cover are its runtime methods, which is what this narrows to.
 */
interface WebviewElement extends HTMLElement {
  getWebContentsId(): number
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  getURL(): string
}

/**
 * Plain-English cause for the Chromium error codes the preview actually hits. The codes
 * here were observed, not guessed: pointing the preview at Postgres reports -324, not
 * the connection-reset code you might expect.
 */
function explain(code: number): string {
  switch (code) {
    case -102: // ERR_CONNECTION_REFUSED
      return ' — nothing is listening on that port. Is the dev server still running?'
    case -324: // ERR_EMPTY_RESPONSE
    case -101: // ERR_CONNECTION_RESET
    case -100: // ERR_CONNECTION_CLOSED
      return ' — something is listening, but it is not serving web pages. Databases and system daemons listen on ports too.'
    case -337: // ERR_SSL_PROTOCOL_ERROR
      return ' — that port speaks HTTPS, or something that is not HTTP. Try the other scheme.'
    case -105: // ERR_NAME_NOT_RESOLVED
      return ' — that host name could not be resolved.'
    case -7: // ERR_TIMED_OUT
      return ' — the server accepted the connection but never replied.'
    default:
      return ''
  }
}

/** Turn "3000", "localhost:3000", or a full URL into something loadable. */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `http://localhost:${trimmed}`
  return `http://${trimmed}`
}

export function Preview(): JSX.Element {
  const view = useRef<WebviewElement | null>(null)
  const {
    previewUrl,
    previewAttached,
    previewFullscreen,
    inspecting,
    setPreviewUrl,
    setPreviewAttached,
    togglePreviewFullscreen,
    startInspect,
    stopInspect,
    ports
  } = useStore()
  const [input, setInput] = useState(previewUrl)
  const [loading, setLoading] = useState(false)
  /**
   * A failed load used to leave the pane completely blank — no error, no hint. Pointing
   * the preview at anything that is not an HTTP server (a database port, say) looked
   * exactly like the preview being broken.
   */
  const [failure, setFailure] = useState<{ code: number; description: string; url: string } | null>(
    null
  )

  // Keep the address bar in step when the URL changes from elsewhere — clicking a port
  // used to load a new page while the bar kept showing the old address.
  useEffect(() => setInput(previewUrl), [previewUrl])

  useEffect(() => {
    const element = view.current
    if (!element) return

    // Hand the webview's id to the main process so AutomationService can attach its
    // debugger. This is what gives Claude control of the page.
    const onReady = (): void => {
      void call('preview:register', element.getWebContentsId()).then(() => setPreviewAttached(true))
    }
    const onStart = (): void => {
      setLoading(true)
      setFailure(null)
    }
    const onStop = (): void => {
      setLoading(false)
      const current = element.getURL()
      if (current && current !== 'about:blank') setInput(current)
    }
    const onDestroyed = (): void => setPreviewAttached(false)

    const onFail = (e: Event): void => {
      const detail = e as Event & {
        errorCode: number
        errorDescription: string
        validatedURL: string
        isMainFrame: boolean
      }
      // Sub-resources fail all the time on a page that is otherwise fine; only a failed
      // main frame means there is nothing to look at. -3 is ERR_ABORTED, which is what
      // a superseded navigation reports — not a real failure.
      if (!detail.isMainFrame || detail.errorCode === -3) return
      setLoading(false)
      setFailure({
        code: detail.errorCode,
        description: detail.errorDescription || 'Could not load the page',
        url: detail.validatedURL
      })
    }

    element.addEventListener('dom-ready', onReady)
    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('did-fail-load', onFail)
    element.addEventListener('destroyed', onDestroyed)
    return () => {
      element.removeEventListener('dom-ready', onReady)
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('did-fail-load', onFail)
      element.removeEventListener('destroyed', onDestroyed)
    }
  }, [previewUrl, setPreviewAttached])

  useEffect(() => {
    if (!previewFullscreen && !inspecting) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (inspecting) void stopInspect()
      else if (previewFullscreen) togglePreviewFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewFullscreen, inspecting, stopInspect, togglePreviewFullscreen])

  const go = (raw: string): void => {
    if (!raw.trim()) return
    setPreviewUrl(normaliseUrl(raw))
  }

  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-bar">
        <button
          className="icon-only"
          title="Go back"
          aria-label="Go back"
          disabled={!previewUrl}
          onClick={() => view.current?.goBack()}
        >
          ‹
        </button>
        <button
          className="icon-only"
          title="Go forward"
          aria-label="Go forward"
          disabled={!previewUrl}
          onClick={() => view.current?.goForward()}
        >
          ›
        </button>
        <button
          className="icon-only"
          title={loading ? 'Loading…' : 'Reload the page'}
          aria-label="Reload"
          disabled={!previewUrl}
          onClick={() => view.current?.reload()}
        >
          {loading ? '◌' : '↻'}
        </button>

        <input
          value={input}
          placeholder="localhost:3000 — or just a port number"
          aria-label="Preview address"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(input)
            if (e.key === 'Escape') setInput(previewUrl)
          }}
        />
        <button className="labelled" title="Load this address" onClick={() => go(input)}>
          Go
        </button>

        <button
          className={`labelled${inspecting ? ' active' : ''}`}
          disabled={!previewUrl}
          aria-pressed={inspecting}
          title={
            inspecting
              ? 'Click an element in the preview — or press Escape to cancel'
              : 'Pick an element in the page and send Claude a note about it'
          }
          onClick={() => void (inspecting ? stopInspect() : startInspect())}
        >
          <span aria-hidden="true">⌖</span> {inspecting ? 'Picking…' : 'Select'}
        </button>

        <button
          className="icon-only"
          aria-pressed={previewFullscreen}
          title={previewFullscreen ? 'Exit full screen (Esc)' : 'Full screen preview'}
          aria-label={previewFullscreen ? 'Exit full screen' : 'Full screen preview'}
          onClick={togglePreviewFullscreen}
        >
          {previewFullscreen ? '⤡' : '⛶'}
        </button>
      </div>

      <div className="preview-body">
        {failure && (
          <div className="preview-error" role="alert">
            <p className="empty-title">Could not load this page</p>
            <p className="preview-error-url">{failure.url}</p>
            <p className="hint">
              {failure.description} ({failure.code}){explain(failure.code)}
            </p>
            <div className="preview-error-actions">
              <button className="primary" onClick={() => view.current?.reload()}>
                Retry
              </button>
              <button className="labelled" onClick={() => setFailure(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {previewUrl ? (
          <webview
            ref={view as never}
            src={previewUrl}
            // Its own partition: an empty cookie jar, isolated from the editor and from
            // the user's real browser. That isolation is what makes unrestricted
            // automation over this view safe.
            partition="persist:preview"
            // webSecurity off inside the preview only, so dev servers with loose CORS
            // and self-signed certs work without fighting the browser.
            webpreferences="webSecurity=no,contextIsolation=yes,nodeIntegration=no"
            className="preview-webview"
          />
        ) : (
          <div className="panel-empty">
            <p className="empty-title">Nothing loaded</p>
            <p className="hint">
              {ports.length > 0
                ? 'Pick one of the ports below, or type an address above.'
                : 'Start a dev server in the terminal and its port will appear below.'}
            </p>
          </div>
        )}
      </div>

      <div className="preview-footer">
        <div className="section-header">
          <span>
            Ports <span className="count">{ports.length}</span>
          </span>
          <span
            className={`cdp-pill${previewAttached ? ' on' : ''}`}
            title={
              previewAttached
                ? 'Chrome DevTools Protocol attached — Claude can click, type, and screenshot this page'
                : 'Load a page to let Claude drive it'
            }
          >
            {previewAttached ? '● Claude can drive this page' : '○ Not attached'}
          </span>
        </div>
        <PortsPanel compact />
      </div>
    </section>
  )
}
