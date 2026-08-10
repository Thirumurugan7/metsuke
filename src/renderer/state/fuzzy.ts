/**
 * Subsequence matching for quick-open, the way editor file pickers have worked since
 * TextMate: "srtp" matches "src/renderer/tabs/Panel.tsx".
 */

/** Matched character positions, or null when the query does not match at all. */
export function fuzzyMatch(text: string, query: string): number[] | null {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const positions: number[] = []

  let at = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, at)
    if (found === -1) return null
    positions.push(found)
    at = found + 1
  }
  return positions
}

/**
 * Lower is better. Prefers matches that are tightly packed and that land in the
 * filename rather than the directory path, with a slight nudge towards shorter paths
 * so `App.tsx` beats `some/deep/nested/App.tsx` for the query "app".
 */
export function score(path: string, positions: number[]): number {
  if (positions.length === 0) return 0
  const spread = positions[positions.length - 1] - positions[0]
  const filenameStart = path.lastIndexOf('/') + 1
  const inFilename = positions.filter((p) => p >= filenameStart).length
  return spread - inFilename * 12 + path.length * 0.05
}

/** Best matches first, capped at `limit`. */
export function rank(paths: string[], query: string, limit = 50): string[] {
  if (!query) return paths.slice(0, limit)

  return paths
    .map((path) => ({ path, positions: fuzzyMatch(path, query) }))
    .filter((r): r is { path: string; positions: number[] } => r.positions !== null)
    .sort((a, b) => score(a.path, a.positions) - score(b.path, b.positions))
    .slice(0, limit)
    .map((r) => r.path)
}
