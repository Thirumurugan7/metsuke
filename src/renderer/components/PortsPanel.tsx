import { useState } from 'react'
import { call, useStore } from '../state/store'
import { Icon } from './Icon'

/**
 * Listening ports, extracted from the preview panel so the sidebar view and the preview
 * footer share one implementation instead of two divergent copies.
 *
 * System ports are hidden by default. The raw list on a normal machine is mostly the
 * OS, background daemons, and the editor's own processes — and picking one of those
 * loads a blank pane, which reads as the preview being broken.
 */
export function PortsPanel({ compact = false }: { compact?: boolean }): JSX.Element {
  const { ports, previewUrl, showInPreview } = useStore()
  const [showAll, setShowAll] = useState(false)

  const interesting = ports.filter((p) => !p.system)
  const hidden = ports.length - interesting.length
  const shown = showAll ? ports : interesting

  if (shown.length === 0) {
    return (
      <div className={compact ? 'ports-empty' : 'panel-empty'}>
        <p>No dev servers listening</p>
        {!compact && (
          <p className="hint">Start one in the terminal and it will appear here automatically.</p>
        )}
        {hidden > 0 && (
          <button className="labelled" onClick={() => setShowAll(true)}>
            Show {hidden} system port{hidden === 1 ? '' : 's'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="port-list">
      {shown.map((port) => {
        const url = `http://localhost:${port.port}`
        const active = previewUrl.startsWith(url)
        return (
          <div
            key={port.port}
            className={`port-row${port.ours ? ' ours' : ''}${active ? ' active' : ''}${port.system ? ' system' : ''}`}
          >
            <button
              className="port-row-main"
              onClick={() => showInPreview(url)}
              title={`Load ${url} in the preview${port.pid ? ` · pid ${port.pid}` : ''}${
                port.system ? ' · not a web server, this will probably be blank' : ''
              }`}
            >
              <span className="port-number">{port.port}</span>
              <span className="port-process">{port.process ?? 'unknown process'}</span>
              {port.ours && <span className="port-badge">started here</span>}
            </button>
            <span className="port-open" aria-hidden="true">
              {active ? 'showing' : 'Preview'}
            </span>
            <button
              className="icon-only port-external"
              title={`Open ${url} in your browser`}
              aria-label={`Open ${url} in your browser`}
              onClick={() => void call('app:openExternal', url)}
            >
              <Icon name="external" />
            </button>
          </div>
        )
      })}

      {hidden > 0 && (
        <button className="port-toggle" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide system ports' : `Show ${hidden} system port${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}
