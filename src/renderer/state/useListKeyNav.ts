import { useCallback } from 'react'

/**
 * Roving keyboard navigation for a flat list of rows, shared by Search's hit list and
 * Source Control's staged/changes sections (K6). Reads rows from the DOM in render
 * order rather than from a flattened model — the same approach Explorer's tree
 * navigation already used, and for the same reason: rows the panel currently is not
 * showing (a collapsed section, in this case) fall out of the sequence for free.
 *
 * `ArrowLeft`/`ArrowRight` are deliberately not handled here — expanding/collapsing is
 * tree-specific behaviour that belongs to Explorer's own handler, which wraps this one.
 */
export function useListKeyNav({
  rowSelector,
  onFocusChange
}: {
  rowSelector: string
  onFocusChange: (id: string | null) => void
}): (event: React.KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ']
      if (!keys.includes(event.key)) return

      const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(rowSelector))
      if (rows.length === 0) return

      const index = rows.indexOf(document.activeElement as HTMLElement)

      if (event.key === 'Enter' || event.key === ' ') {
        const row = index >= 0 ? rows[index] : null
        if (row && document.activeElement === row) {
          event.preventDefault()
          row.click()
        }
        return
      }

      const move = (to: number): void => {
        const target = rows[Math.max(0, Math.min(rows.length - 1, to))]
        if (!target) return
        event.preventDefault()
        target.focus()
        onFocusChange(target.dataset['id'] ?? target.dataset['path'] ?? null)
      }

      switch (event.key) {
        case 'ArrowDown':
          return move(index + 1)
        case 'ArrowUp':
          return move(index - 1)
        case 'Home':
          return move(0)
        case 'End':
          return move(rows.length - 1)
      }
    },
    [rowSelector, onFocusChange]
  )
}
