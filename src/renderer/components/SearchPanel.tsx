import { useState } from 'react'
import { call, useStore } from '../state/store'

export function SearchPanel(): JSX.Element {
  const { workspace, openFile } = useStore()
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<Array<{ path: string; line: number; text: string }>>([])
  const [searching, setSearching] = useState(false)

  if (!workspace) return <div className="panel-empty">No folder open</div>

  const search = async (): Promise<void> => {
    if (!query) return setResults([])
    setSearching(true)
    const found = await call('files:search', query, { regex, caseSensitive, limit: 300 })
    setResults(found ?? [])
    setSearching(false)
  }

  // Group by file so the list reads like VS Code's, not a flat wall of lines.
  const byFile = results.reduce<Record<string, typeof results>>((acc, r) => {
    ;(acc[r.path] ??= []).push(r)
    return acc
  }, {})

  return (
    <div className="search-panel">
      <div className="search-controls">
        <input
          value={query}
          placeholder="Search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <div className="search-toggles">
          <button className={caseSensitive ? 'active' : ''} title="Match case" onClick={() => setCaseSensitive((v) => !v)}>
            Aa
          </button>
          <button className={regex ? 'active' : ''} title="Regular expression" onClick={() => setRegex((v) => !v)}>
            .*
          </button>
        </div>
      </div>

      <div className="search-summary">
        {searching
          ? 'Searching…'
          : results.length > 0
            ? `${results.length} results in ${Object.keys(byFile).length} files`
            : query
              ? 'No results'
              : ''}
      </div>

      <div className="search-results">
        {Object.entries(byFile).map(([path, matches]) => (
          <div key={path} className="search-file">
            <div className="search-file-name" title={path}>
              {path}
            </div>
            {matches.map((m, i) => (
              <div key={i} className="search-hit" onClick={() => void openFile(m.path)}>
                <span className="search-line">{m.line}</span>
                <span className="search-text">{m.text.trim()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
