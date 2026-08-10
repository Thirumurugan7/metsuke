import { describe, it, expect } from 'vitest'
import { fuzzyMatch, rank } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches a contiguous substring', () => {
    expect(fuzzyMatch('src/App.tsx', 'app')).toEqual([4, 5, 6])
  })

  it('matches a scattered subsequence', () => {
    expect(fuzzyMatch('src/renderer/Panel.tsx', 'srp')).not.toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('src/App.tsx', 'APP')).toEqual([4, 5, 6])
  })

  it('returns null when a character is missing', () => {
    expect(fuzzyMatch('src/App.tsx', 'zzz')).toBeNull()
  })

  it('respects order — the same letters in the wrong sequence do not match', () => {
    expect(fuzzyMatch('abc.ts', 'cba')).toBeNull()
  })

  it('treats an empty query as matching everything', () => {
    expect(fuzzyMatch('anything', '')).toEqual([])
  })
})

describe('rank', () => {
  const paths = [
    'src/renderer/components/EditorPane.tsx',
    'src/renderer/state/store.ts',
    'src/main/services/GitService.ts',
    'src/main/services/GitService.test.ts',
    'package.json',
    'src/shared/ipc.ts'
  ]

  it('puts a filename match ahead of a path-only match', () => {
    // "store" appears in the filename of store.ts and nowhere else as a filename.
    expect(rank(paths, 'store')[0]).toBe('src/renderer/state/store.ts')
  })

  it('prefers the shorter path when both match in the filename', () => {
    expect(rank(paths, 'gitservice')[0]).toBe('src/main/services/GitService.ts')
  })

  it('drops non-matching paths entirely', () => {
    expect(rank(paths, 'ipc')).toEqual(['src/shared/ipc.ts'])
  })

  it('returns everything up to the limit for an empty query', () => {
    expect(rank(paths, '', 3)).toHaveLength(3)
  })

  it('honours the limit', () => {
    expect(rank(paths, 's', 2)).toHaveLength(2)
  })

  it('finds a file from initials spanning the path', () => {
    expect(rank(paths, 'srcep')).toContain('src/renderer/components/EditorPane.tsx')
  })
})
