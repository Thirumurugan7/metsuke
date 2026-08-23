import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { PortsPanel } from './PortsPanel'
import { Icon } from './Icon'

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
      return '. Nothing is listening on that port. Is the dev server still running?'
    case -324: // ERR_EMPTY_RESPONSE
    case -101: // ERR_CONNECTION_RESET
    case -100: // ERR_CONNECTION_CLOSED
      return '. Something is listening, but it is not serving web pages. Databases and system daemons listen on ports too.'
    case -337: // ERR_SSL_PROTOCOL_ERROR
      return '. That port speaks HTTPS, or something that is not HTTP. Try the other scheme.'
    case -105: // ERR_NAME_NOT_RESOLVED
      return '. That host name could not be resolved.'
    case -7: // ERR_TIMED_OUT
      return '. The server accepted the connection but never replied.'
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

/** localStorage key for the one-time "Point at it" coach mark — same mechanism batch 7
 *  used for recent files, just a boolean instead of a list. */
const COACH_SEEN_KEY = 'metsuke.previewCoachSeen'

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

type WidthPreset = 'full' | 'tablet' | 'mobile'

/** `short` is the toolbar button's own label — the address bar needs the room more
 *  than this button does, so the full description only shows inside the dropdown. */
const WIDTH_PRESETS: Array<{ id: WidthPreset; short: string; label: string; width: number | null }> = [
  { id: 'full', short: 'Full', label: 'Full width', width: null },
  { id: 'tablet', short: 'Tablet', label: 'Tablet (768px)', width: 768 },
  { id: 'mobile', short: 'Mobile', label: 'Mobile (375px)', width: 375 }
]

const MOD = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'

export function Preview(): JSX.Element {
  const view = useRef<WebviewElement | null>(null)
  const {
    workspace,
    previewUrl,
    previewAttached,
    previewFullscreen,
    previewReloadRequest,
    inspecting,
    setPreviewUrl,
    setPreviewAttached,
    togglePreviewFullscreen,
    startInspect,
    stopInspect,
    runDevServer,
    togglePanel,
    ports,
    previewPortsCollapsed,
    togglePreviewPortsCollapsed
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

  const usable = ports.filter((p) => !p.system)

  // -- one-time coach mark for "Point at it" ---------------------------------

  const [showCoach, setShowCoach] = useState(false)

  // -- brief "how do I get out" hint, for fullscreen and picking mode -------

  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showHint = (text: string): void => {
    setHint(text)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(null), 2600)
  }
  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current)
  }, [])
  useEffect(() => {
    if (previewFullscreen) showHint('Press Esc to exit.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFullscreen])
  useEffect(() => {
    if (inspecting) showHint('Click an element, or press Esc to cancel.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspecting])

  // -- responsive width preset, independent of the panel splitter -----------
  // Lives inside the overflow menu now, not its own toolbar button — it is a niche
  // control that used to take prime space for something reached rarely.

  const [preset, setPreset] = useState<WidthPreset>('full')

  // -- overflow menu: the width preset always, back/forward/external-open once the
  //    bar narrows too much to hold them (below) ----------------------------------

  const overflowButton = useRef<HTMLButtonElement>(null)
  const [overflowMenu, setOverflowMenu] = useState<{ right: number; top: number } | null>(null)
  useEffect(() => {
    if (!overflowMenu) return
    const close = (): void => setOverflowMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [overflowMenu])
  const toggleOverflowMenu = (): void => {
    if (overflowMenu) return setOverflowMenu(null)
    const rect = overflowButton.current?.getBoundingClientRect()
    if (!rect) return
    setOverflowMenu({ right: window.innerWidth - rect.right, top: rect.bottom + 4 })
  }

  // -- priority-based responsive collapse ------------------------------------
  // Driven by the bar's own measured width, not the window: this pane resizes
  // independently of it (the splitter, fullscreen, the sidebar toggling). Degrades in
  // priority order — least essential first — by moving controls into the overflow
  // menu rather than clipping them off past the panel edge.
  const bar = useRef<HTMLDivElement>(null)
  const [collapsePointLabel, setCollapsePointLabel] = useState(false)
  const [collapseNav, setCollapseNav] = useState(false)
  const [collapseExternal, setCollapseExternal] = useState(false)
  useEffect(() => {
    const element = bar.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setCollapsePointLabel(width < 480)
      setCollapseNav(width < 380)
      setCollapseExternal(width < 320)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // -- smart empty state: offer the thing this project can actually do ------

  const [hasDevScript, setHasDevScript] = useState(false)
  useEffect(() => {
    setHasDevScript(false)
    if (previewUrl || usable.length > 0 || !workspace) return
    let cancelled = false
    void call('files:list', '').then((entries) => {
      if (cancelled || !entries?.some((e) => !e.isDirectory && e.name === 'package.json')) return
      void call('files:read', `${workspace.root}/package.json`).then((raw) => {
        if (cancelled || !raw) return
        try {
          const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
          if (pkg.scripts?.dev) setHasDevScript(true)
        } catch {
          // Malformed package.json; nothing more to offer here.
        }
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, usable.length, workspace?.root])

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
      // The first page that actually reaches the DOM is the moment "Point at it" starts
      // to matter. A failed navigation (wrong port, connection refused) never fires
      // dom-ready, so this does not fire for those.
      if (localStorage.getItem(COACH_SEEN_KEY) !== '1') {
        localStorage.setItem(COACH_SEEN_KEY, '1')
        setShowCoach(true)
      }
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

  // The command palette's preview.reload has no webview ref of its own to call — this is
  // the only place that owns one, so it watches the counter instead.
  useEffect(() => {
    if (previewReloadRequest === 0) return
    view.current?.reload()
  }, [previewReloadRequest])

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

  const widthPreset = WIDTH_PRESETS.find((p) => p.id === preset)!
  // Display only: the scheme comes back on submit via normaliseUrl. Same convention
  // every browser omnibox already uses.
  const displayInput = input.replace(/^https?:\/\//i, '')

  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-bar" ref={bar}>
        {!collapseNav && (
          <>
            <button
              className="icon-only preview-tool"
              title="Go back"
              aria-label="Go back"
              disabled={!previewUrl}
              onClick={() => view.current?.goBack()}
            >
              <Icon name="back" />
            </button>
            <button
              className="icon-only preview-tool"
              title="Go forward"
              aria-label="Go forward"
              disabled={!previewUrl}
              onClick={() => view.current?.goForward()}
            >
              <Icon name="forward" />
            </button>
          </>
        )}
        <button
          className="icon-only preview-tool"
          title={loading ? 'Loading…' : 'Reload the page'}
          aria-label="Reload"
          disabled={!previewUrl}
          onClick={() => view.current?.reload()}
        >
          {loading ? '◌' : <Icon name="reload" />}
        </button>

        <input
          className="preview-address"
          value={displayInput}
          placeholder="localhost:3000"
          aria-label="Preview address"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(input)
            if (e.key === 'Escape') setInput(previewUrl)
          }}
        />

        <div className="width-preset">
          <button
            ref={overflowButton}
            className="icon-only preview-tool"
            title="More"
            aria-label="More preview controls"
            aria-haspopup="menu"
            aria-expanded={overflowMenu !== null}
            onClick={(e) => {
              e.stopPropagation()
              toggleOverflowMenu()
            }}
          >
            <Icon name="more" />
          </button>
          {overflowMenu && (
            <div
              className="width-menu"
              role="menu"
              style={{ right: overflowMenu.right, top: overflowMenu.top }}
              onClick={(e) => e.stopPropagation()}
            >
              {collapseNav && (
                <>
                  <button
                    role="menuitem"
                    disabled={!previewUrl}
                    onClick={() => {
                      view.current?.goBack()
                      setOverflowMenu(null)
                    }}
                  >
                    <Icon name="back" /> Go back
                  </button>
                  <button
                    role="menuitem"
                    disabled={!previewUrl}
                    onClick={() => {
                      view.current?.goForward()
                      setOverflowMenu(null)
                    }}
                  >
                    <Icon name="forward" /> Go forward
                  </button>
                  <div className="context-sep" />
                </>
              )}
              {collapseExternal && (
                <>
                  <button
                    role="menuitem"
                    disabled={!previewUrl}
                    onClick={() => {
                      void call('app:openExternal', previewUrl)
                      setOverflowMenu(null)
                    }}
                  >
                    <Icon name="external" /> Open in your browser
                  </button>
                  <div className="context-sep" />
                </>
              )}
              {WIDTH_PRESETS.map((p) => (
                <button
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={p.id === preset}
                  onClick={() => {
                    setPreset(p.id)
                    setOverflowMenu(null)
                  }}
                >
                  {p.id === preset && <Icon name="check" />} {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="header-sep" />

        {/* The product's strongest differentiator (G1), but a mode you can turn on,
            not an importance you should feel at rest — ghost until active, so the
            fill itself is what tells you inspecting is on. */}
        <button
          className={`point-at-it${inspecting ? ' active' : ''}${collapsePointLabel ? ' compact' : ''}`}
          disabled={!previewUrl}
          aria-pressed={inspecting}
          title={
            inspecting
              ? 'Click an element in the preview, or press Escape to cancel (⌘⇧P)'
              : 'Point at an element and tell Claude what should change (⌘⇧P)'
          }
          onClick={() => {
            setShowCoach(false)
            void (inspecting ? stopInspect() : startInspect())
          }}
        >
          <Icon name="pointAtElement" />
          {!collapsePointLabel && (
            <span className="point-at-it-label">{inspecting ? 'Picking…' : 'Point at it'}</span>
          )}
        </button>
        {showCoach && (
          <div className="preview-coach" role="status">
            <p>Click any element and tell Claude what should change.</p>
            <button className="icon-only" title="Dismiss" aria-label="Dismiss" onClick={() => setShowCoach(false)}>
              <Icon name="close" />
            </button>
          </div>
        )}

        <div className="header-sep" />

        <button
          className="icon-only preview-tool"
          aria-pressed={previewFullscreen}
          title={previewFullscreen ? 'Exit full screen (Esc)' : 'Full screen preview'}
          aria-label={previewFullscreen ? 'Exit full screen' : 'Full screen preview'}
          onClick={togglePreviewFullscreen}
        >
          <Icon name={previewFullscreen ? 'exitFullscreen' : 'fullscreen'} />
        </button>

        {!collapseExternal && (
          <button
            className="icon-only preview-tool"
            title="Open in your browser"
            aria-label="Open in your browser"
            disabled={!previewUrl}
            onClick={() => void call('app:openExternal', previewUrl)}
          >
            <Icon name="external" />
          </button>
        )}

        <button
          className="icon-only preview-tool"
          title={`Close preview (${MOD}⇧V)`}
          aria-label="Close preview"
          onClick={() => togglePanel('preview')}
        >
          <Icon name="close" />
        </button>
      </div>

      {/* Static under reduced motion rather than an animated sweep — still visible
          proof that something is happening, without the motion. */}
      <div
        className={`preview-progress${loading ? ' active' : ''}${prefersReducedMotion() ? ' reduced' : ''}`}
        aria-hidden="true"
      />

      <div className="preview-body">
        {hint && (
          <div className="escape-hint" role="status">
            {hint}
          </div>
        )}

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
            style={widthPreset.width ? { width: widthPreset.width } : undefined}
          />
        ) : usable.length > 0 ? (
          <div className="panel-empty">
            <p className="empty-title">Nothing loaded</p>
            <p className="hint">A dev server is already running.</p>
            <button className="primary" onClick={() => setPreviewUrl(`http://localhost:${usable[0].port}`)}>
              Load localhost:{usable[0].port}
            </button>
          </div>
        ) : hasDevScript ? (
          <div className="panel-empty">
            <p className="empty-title">Nothing loaded</p>
            <p className="hint">This project has a dev script, but nothing is running yet.</p>
            <button className="primary" onClick={() => runDevServer('npm', ['run', 'dev'])}>
              Run npm run dev
            </button>
          </div>
        ) : (
          <div className="panel-empty">
            <p className="empty-title">Nothing loaded</p>
            <p className="hint">Start a dev server in the terminal and its port will appear below.</p>
          </div>
        )}
      </div>

      <div className="preview-footer">
        <button
          className="section-header"
          aria-expanded={!previewPortsCollapsed}
          title={previewPortsCollapsed ? 'Show ports' : 'Hide ports'}
          onClick={togglePreviewPortsCollapsed}
        >
          <span className="section-header-title">
            <Icon name={previewPortsCollapsed ? 'forward' : 'chevronDown'} size={12} />
            Ports <span className="count">{usable.length}</span>
          </span>
          {/* Says nothing until it's true (G5) — the fix for a negative-by-default
              pill is silence, not a less alarming negative. */}
          {previewAttached && (
            <span
              className="cdp-pill on"
              title="Chrome DevTools Protocol attached. Claude can click, type, and screenshot this page"
            >
              ● Claude can control this page
            </span>
          )}
        </button>
        {!previewPortsCollapsed && <PortsPanel compact />}
      </div>
    </section>
  )
}
