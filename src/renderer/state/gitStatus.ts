import type { GitFileStatus } from '@shared/ipc'

/**
 * One git status badge, drawn once (K4).
 *
 * Explorer and Source Control used to each implement this, disagreeing on both the
 * letters (Explorer collapsed modified/renamed/copied all to `M`; Source Control kept
 * `R` and `C` distinct) and the class family (`badge-*` versus `.git-letter`/`.letter-*`).
 * Source Control's letters survive here since they carry strictly more information at no
 * extra cost — the tooltip already explains what each one means.
 */
export function statusBadge(state: GitFileStatus): { letter: string; className: string; label: string } | null {
  switch (state) {
    case 'modified':
      return { letter: 'M', className: 'badge-modified', label: 'Modified' }
    case 'added':
      return { letter: 'A', className: 'badge-added', label: 'Added' }
    case 'deleted':
      return { letter: 'D', className: 'badge-deleted', label: 'Deleted' }
    case 'renamed':
      return { letter: 'R', className: 'badge-modified', label: 'Renamed' }
    case 'copied':
      return { letter: 'C', className: 'badge-modified', label: 'Copied' }
    case 'untracked':
      return { letter: 'U', className: 'badge-untracked', label: 'Untracked' }
    case 'conflicted':
      return { letter: '!', className: 'badge-conflict', label: 'Conflicted — resolve before committing' }
    default:
      return null
  }
}
