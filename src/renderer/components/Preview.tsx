import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'

/**
 * React's own types already cover the <webview> element and its Electron attributes;
 * what they do not cover are its runtime methods, which is what this narrows to.
 */
interface WebviewElement extends HTMLElement {
  getWebContentsId(): number
  reload(): void
  loadURL(url: string): Promise<void>
  getURL(): string
}

export function Preview(): JSX.Element {
  const view = useRef<WebviewElement | null>(null)
  const { previewUrl, ports, setPreviewUrl } = useStore()
  const [input, setInput] = useState('')
  const [ready, setReady] = useState(false)

  // Hand the webview's id to the main process so AutomationService can attach its
  // debugger. This is what gives Claude control of the page.
  useEffect(() => {
    const element = view.current
    if (!element) return

    const onAttached = (): void => {
      void call('preview:register', element.getWebContentsId())
      setReady(true)
    }

    element.addEventListener('dom-ready', onAttached)
    return () => element.removeEventListener('dom-ready', onAttached)
  }, [])

  const go = (raw: string): void => {
    const url = /^https?:\/\//.test(raw)
      ? raw
      : /^\d+$/.test(raw)
        ? `http://localhost:${raw}`
        : `http://${raw}`
    setPreviewUrl(url)
    setInput(url)
  }

  return (
    <div className="preview">
      <div className="preview-bar">
        <button title="Reload" disabled={!ready} onClick={() => view.current?.reload()}>
          ↻
        </button>
        <input
          value={input}
          placeholder="localhost:3000"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(input)
          }}
        />
        <span className={`preview-cdp${ready ? ' on' : ''}`} title={ready ? 'Claude can drive this page' : 'Not attached'}>
          ⬤ CDP
        </span>
      </div>

      <div className="preview-body">
        {previewUrl ? (
          <webview
            ref={view as never}
            src={previewUrl}
            // Its own partition: an empty cookie jar, isolated from the editor and
            // from the user's real browser. That isolation is what makes unrestricted
            // automation over this view safe.
            partition="persist:preview"
            // webSecurity off inside the preview only, so dev servers with loose CORS
            // and self-signed certs work without fighting the browser.
            webpreferences="webSecurity=no,contextIsolation=yes,nodeIntegration=no"
            className="preview-webview"
          />
        ) : (
          <div className="panel-empty">
            <p>No preview loaded</p>
            <p className="hint">Pick a port below, or type a URL above.</p>
          </div>
        )}
      </div>

      <div className="ports">
        <div className="section-header">
          Ports <span className="count">{ports.length}</span>
        </div>
        {ports.length === 0 && <div className="ports-empty">No servers listening</div>}
        {ports.map((port) => (
          <div
            key={port.port}
            className={`port-row${port.ours ? ' ours' : ''}`}
            onClick={() => go(String(port.port))}
            title={port.pid ? `pid ${port.pid}` : undefined}
          >
            <span className="port-number">{port.port}</span>
            <span className="port-process">{port.process ?? 'unknown'}</span>
            {port.ours && <span className="port-badge">started here</span>}
            <span className="port-open">↗</span>
          </div>
        ))}
      </div>
    </div>
  )
}
