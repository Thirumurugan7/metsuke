import { useEffect, useMemo, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { rank } from '../state/fuzzy'
import { useFocusTrap } from '../a11y/useFocusTrap'

export function QuickOpen(): JSX.Element | null {
  const { quickOpen, workspace, setQuickOpen, openFile } = useStore()
  const [files, setFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useFocusTrap(dialog, quickOpen, input)

  // Index lazily, on open, so startup is not delayed by walking a large repo.
  useEffect(() => {
    if (!quickOpen || !workspace) return
    setQuery('')
    setSelected(0)
    void call('files:all').then((all) => all && setFiles(all))
    input.current?.focus()
  }, [quickOpen, workspace])

  const results = useMemo(() => rank(files, query), [files, query])

  if (!quickOpen) return null

  const choose = (path: string): void => {
    void openFile(path)
    setQuickOpen(false)
  }

  return (
    <div className="overlay" onMouseDown={() => setQuickOpen(false)}>
      <div
        ref={dialog}
        className="quick-open"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Go to file"
      >
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="Go to file…"
          aria-label="Search files by name"
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setQuickOpen(false)
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((i) => Math.min(i + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((i) => Math.max(i - 1, 0))
            }
            if (e.key === 'Enter' && results[selected]) choose(results[selected])
          }}
        />

        <div className="quick-open-results">
          {results.length === 0 && (
            <div className="quick-open-empty">
              {files.length === 0 ? 'Indexing…' : 'No matching files'}
            </div>
          )}
          {results.map((path, i) => (
            <div
              key={path}
              className={`quick-open-row${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(path)}
            >
              <span className="quick-open-name">{path.split('/').pop()}</span>
              <span className="quick-open-dir">{path.split('/').slice(0, -1).join('/')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
