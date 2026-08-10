import { useStore } from '../state/store'

/**
 * Listening ports, extracted from the preview panel so the sidebar view and the
 * preview footer share one implementation instead of two divergent copies.
 */
export function PortsPanel({ compact = false }: { compact?: boolean }): JSX.Element {
  const { ports, previewUrl, showInPreview } = useStore()

  if (ports.length === 0) {
    return (
      <div className={compact ? 'ports-empty' : 'panel-empty'}>
        <p>No servers listening</p>
        {!compact && (
          <p className="hint">
            Start a dev server in the terminal and it will appear here automatically.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="port-list">
      {ports.map((port) => {
        const url = `http://localhost:${port.port}`
        const active = previewUrl.startsWith(url)
        return (
          <button
            key={port.port}
            className={`port-row${port.ours ? ' ours' : ''}${active ? ' active' : ''}`}
            onClick={() => showInPreview(url)}
            title={`Open ${url} in the preview${port.pid ? ` · pid ${port.pid}` : ''}`}
          >
            <span className="port-number">{port.port}</span>
            <span className="port-process">{port.process ?? 'unknown process'}</span>
            {port.ours && <span className="port-badge">started here</span>}
            <span className="port-open" aria-hidden="true">
              {active ? 'showing' : 'open ↗'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
