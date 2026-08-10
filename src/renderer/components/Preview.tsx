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

/** Turn "3000", "localhost:3000", or a full URL into something loadable. */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//.test(trimmed)) return trimmed
  if (/^\d+$/.test(trimmed)) return `http://localhost:${trimmed}`
  return `http://${trimmed}`
}

export function Preview(): JSX.Element {
  const view = useRef<WebviewElement | null>(null)
  const { previewUrl, previewAttached, setPreviewUrl, setPreviewAttached, ports } = useStore()
  const [input, setInput] = useState(previewUrl)
  const [loading, setLoading] = useState(false)

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
    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      const current = element.getURL()
      if (current && current !== 'about:blank') setInput(current)
    }
    const onDestroyed = (): void => setPreviewAttached(false)

    element.addEventListener('dom-ready', onReady)
    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('destroyed', onDestroyed)
    return () => {
      element.removeEventListener('dom-ready', onReady)
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('destroyed', onDestroyed)
    }
  }, [previewUrl, setPreviewAttached])

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
      </div>

      <div className="preview-body">
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
