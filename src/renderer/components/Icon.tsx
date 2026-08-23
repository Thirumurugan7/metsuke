import type { JSX, ReactNode } from 'react'
import { ClaudeMark } from './ClaudeMark'
import {
  FolderTree,
  Search,
  GitBranch,
  Sparkles,
  Plug,
  Monitor,
  TerminalSquare,
  FolderOpen,
  Bell,
  Crosshair,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Maximize,
  Minimize,
  X,
  Plus,
  ChevronDown,
  Check,
  ExternalLink,
  PanelLeft,
  PanelBottom,
  PanelRight,
  Hash,
  FolderPlus,
  Folder,
  File,
  ChevronsDownUp,
  ArrowDown,
  ArrowUp,
  Minus,
  Undo2,
  MoreHorizontal,
  GitMerge,
  Lock,
  Clock,
  CheckCircle2
} from 'lucide-react'

/**
 * Structural shape every entry below must accept — every `lucide-react` icon already
 * does, and it is loose enough for the one bespoke component in the set (`ClaudeMark`)
 * to as well, without pulling in Lucide's own (unexported) prop type.
 */
type IconGlyph = (props: {
  size?: number
  strokeWidth?: number
  className?: string
  'aria-hidden'?: boolean | 'true' | 'false'
}) => ReactNode

/**
 * One glyph, one meaning, one place this is declared. Every icon used anywhere in the
 * app is named here — if two features need "the same kind of thing," they import the
 * same name, so a collision like the old ▤ meaning four things becomes structurally
 * impossible.
 */
export const ICONS = {
  files: FolderTree,
  search: Search,
  git: GitBranch,
  agents: Sparkles,
  ports: Plug,
  preview: Monitor,
  sessions: TerminalSquare,
  openFolder: FolderOpen,
  notifications: Bell,
  pointAtElement: Crosshair,
  settings: SlidersHorizontal,
  back: ChevronLeft,
  forward: ChevronRight,
  reload: RotateCw,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  close: X,
  add: Plus,
  chevronDown: ChevronDown,
  check: Check,
  branch: GitBranch, // same glyph as `git`, deliberately — same meaning
  external: ExternalLink,
  sidebar: PanelLeft,
  terminalPanel: PanelBottom,
  previewPanel: PanelRight,
  gotoLine: Hash,
  folderAdd: FolderPlus,
  folder: Folder,
  folderOpen: FolderOpen, // same glyph as `openFolder`, deliberately — same meaning
  file: File,
  collapseAll: ChevronsDownUp,
  pull: ArrowDown,
  push: ArrowUp,
  unstage: Minus,
  discard: Undo2,
  more: MoreHorizontal,
  land: GitMerge,
  lock: Lock,
  waiting: Clock,
  done: CheckCircle2,
  // Not a Lucide icon — see ClaudeMark.tsx for why it still belongs in this set.
  claude: ClaudeMark
  // add more only when a real batch needs one — do not pre-populate speculative icons
} as const satisfies Record<string, IconGlyph>

export function Icon({
  name,
  size = 16,
  className
}: {
  name: keyof typeof ICONS
  // 12 is the tree/list disclosure caret's size (batch 10) — every other use stays 16 or 20.
  size?: 12 | 16 | 20
  className?: string
}): JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" className={className} />
}
