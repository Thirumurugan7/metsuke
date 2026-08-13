import { useState } from 'react'
import { call, useStore } from '../state/store'

export function SearchPanel(): JSX.Element {
  const { workspace, openFile } = useStore()
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<Array<{ path: string; line: number; text: string }>>([])
  const [searching, setSearching] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [replaced, setReplaced] = useState<{ files: number; replacements: number } | null>(null)

  if (!workspace) return <div className="panel-empty">No folder open</div>

  const search = async (): Promise<void> => {
    setReplaced(null)
    if (!query) return setResults([])
    setSearching(true)
    const found = await call('files:search', query, { regex, caseSensitive, limit: 300 })
    setResults(found ?? [])
    setSearching(false)
  }

  /**
   * Replace across exactly the files listed above, not across the workspace.
   *
   * Passing the paths matters: the result list is capped, so a workspace-wide replace
   * could edit files the user was never shown. Confining it to what is on screen means
   * what you see is what changes.
   */
  const replaceAll = async (): Promise<void> => {
    const paths = [...new Set(results.map((r) => r.path))]
    if (!query || paths.length === 0) return

    setReplacing(true)
    const done = await call('files:replace', query, replacement, { regex, caseSensitive, paths })
    setReplacing(false)
    if (!done) return

    setReplaced(done)
    // The old hits describe text that is no longer there, so re-run rather than leave
    // a list that lies about the file.
    await search()
  }

  // Group by file so the list reads like VS Code's, not a flat wall of lines.
  const byFile = results.reduce<Record<string, typeof results>>((acc, r) => {
    ;(acc[r.path] ??= []).push(r)
    return acc
  }, {})

  return (
    <div className="search-panel">
      <div className="search-controls">
        <button
          className={`icon-only search-expand${showReplace ? ' active' : ''}`}
          title={showReplace ? 'Hide replace' : 'Show replace'}
          aria-label="Toggle replace"
          aria-expanded={showReplace}
          onClick={() => setShowReplace((v) => !v)}
        >
          {showReplace ? '⌄' : '›'}
        </button>
        <input
          value={query}
          placeholder="Search in files — press Enter"
          aria-label="Search text in files"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search()
          }}
        />
        <div className="search-toggles">
          <button
            className={`icon-only${caseSensitive ? ' active' : ''}`}
            title="Match case"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            className={`icon-only${regex ? ' active' : ''}`}
            title="Use regular expression"
            aria-label="Use regular expression"
            aria-pressed={regex}
            onClick={() => setRegex((v) => !v)}
          >
            .*
          </button>
        </div>
      </div>

      {showReplace && (
        <div className="search-replace">
          <input
            value={replacement}
            placeholder={regex ? 'Replace with, $1 for a group' : 'Replace with'}
            aria-label="Replacement text"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void replaceAll()
            }}
          />
          <button
            className="primary"
            disabled={replacing || results.length === 0}
            onClick={() => void replaceAll()}
            title={
              results.length === 0
                ? 'Search first: replace only touches the files listed below'
                : `Replace in ${new Set(results.map((r) => r.path)).size} files`
            }
          >
            {replacing ? 'Replacing…' : 'Replace all'}
          </button>
        </div>
      )}

      {replaced && (
        <p className="search-summary">
          Replaced {replaced.replacements} occurrence
          {replaced.replacements === 1 ? '' : 's'} in {replaced.files} file
          {replaced.files === 1 ? '' : 's'}.
        </p>
      )}

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
              // Jumps to the matching line; previously it opened the file at line 1,
              // leaving you to find the match yourself.
              <div
                key={i}
                className="search-hit"
                title={`${m.path}:${m.line}`}
                onClick={() => void openFile(m.path, m.line)}
              >
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
