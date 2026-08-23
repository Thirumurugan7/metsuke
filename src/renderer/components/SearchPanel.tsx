import { useEffect, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { useListKeyNav } from '../state/useListKeyNav'
import { Icon } from './Icon'

/** The panel header's actions slot (K8): Clear, the only action this panel needs there. */
export function SearchActions(): JSX.Element {
  const requestSearchClear = useStore((s) => s.requestSearchClear)
  return (
    <button className="icon-only" title="Clear search" aria-label="Clear search" onClick={() => requestSearchClear()}>
      <Icon name="close" />
    </button>
  )
}

export function SearchPanel(): JSX.Element {
  const { workspace, openFile, searchClearRequest } = useStore()
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<Array<{ path: string; line: number; text: string }>>([])
  const [searching, setSearching] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [replaced, setReplaced] = useState<{ files: number; replacements: number } | null>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

  const onListKeyDown = useListKeyNav({
    rowSelector: '.search-hit[role="option"]',
    onFocusChange: () => {}
  })

  // Compared against the last value this instance saw, not against 0 — SearchPanel
  // unmounts on every sidebar view switch (same root cause as GitPanel's discard-all
  // nonce), so a plain remount must not replay a stale clear.
  const lastSearchClearRequest = useRef(searchClearRequest)
  useEffect(() => {
    if (searchClearRequest === lastSearchClearRequest.current) return
    lastSearchClearRequest.current = searchClearRequest
    setQuery('')
    setReplacement('')
    setResults([])
    setReplaced(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchClearRequest])

  if (!workspace) {
    return (
      <div className="panel-empty">
        <p className="empty-title">No folder open</p>
        <p className="hint">Open a folder to search its files.</p>
        <button className="primary" onClick={() => void useStore.getState().openFolder()}>
          Open Folder
        </button>
      </div>
    )
  }

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

  const toggleFile = (path: string): void => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="search-panel panel">
      <div className="panel-toolbar search-toolbar">
        <div className="search-row">
          <input
            value={query}
            placeholder="Search in files"
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

        <div className="search-row">
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
      </div>

      <div className="panel-content" role="listbox" aria-label="Search results" onKeyDown={onListKeyDown}>
        {results.length === 0 && !searching && (
          <div className="panel-empty">
            {query ? (
              <>
                <p className="empty-title">No matches for that query.</p>
                {!regex && <p className="hint">Try .* to search by pattern.</p>}
              </>
            ) : (
              <>
                <p className="empty-title">Search every file in this project.</p>
                <p className="hint">
                  Press Enter to run it. Aa matches case, .* reads the query as a regular
                  expression.
                </p>
              </>
            )}
          </div>
        )}

        {Object.entries(byFile).map(([path, matches]) => {
          const fileCollapsed = collapsedFiles.has(path)
          return (
            <div key={path} className="search-file">
              <button className="search-file-name" aria-expanded={!fileCollapsed} onClick={() => toggleFile(path)}>
                <span className="section-header-title">
                  <Icon name={fileCollapsed ? 'forward' : 'chevronDown'} size={12} />
                  <span className="search-file-path" title={path}>
                    {path}
                  </span>
                </span>
                <span className="count">{matches.length}</span>
              </button>
              {!fileCollapsed &&
                matches.map((m, i) => (
                  // Jumps to the matching line; previously it opened the file at line 1,
                  // leaving you to find the match yourself.
                  <div
                    key={i}
                    className="search-hit"
                    role="option"
                    aria-selected="false"
                    tabIndex={0}
                    data-id={`${m.path}:${m.line}`}
                    title={`${m.path}:${m.line}`}
                    onClick={() => void openFile(m.path, m.line)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void openFile(m.path, m.line)
                    }}
                  >
                    <span className="search-line">{m.line}</span>
                    <span className="search-text">{m.text.trim()}</span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      <div className="panel-footer">
        {replaced
          ? `Replaced ${replaced.replacements} occurrence${replaced.replacements === 1 ? '' : 's'} in ${replaced.files} file${replaced.files === 1 ? '' : 's'}.`
          : searching
            ? 'Searching…'
            : results.length > 0
              ? `${results.length} results in ${Object.keys(byFile).length} files`
              : ''}
      </div>
    </div>
  )
}
