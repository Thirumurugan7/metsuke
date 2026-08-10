import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

/** Kept in sync with FileService's skip list, plus editor noise. */
const IGNORED = [
  /(^|[/\\])\../, // dotfiles and dotdirs, including .git
  /node_modules/,
  /[/\\](dist|out|build|target|__pycache__|venv)[/\\]/
]

/**
 * Watches the workspace and coalesces bursts of filesystem activity into a single
 * callback. Claude editing ten files in a second should repaint the UI once, not ten
 * times, so changes accumulate in a set and flush on a trailing debounce.
 */
export class WatcherService {
  readonly #root: string
  readonly #debounceMs: number
  #watcher: FSWatcher | null = null
  #pending = new Set<string>()
  #timer: NodeJS.Timeout | null = null
  #onChange: ((paths: string[]) => void) | null = null

  constructor(root: string, opts: { debounceMs?: number } = {}) {
    this.#root = path.resolve(root)
    this.#debounceMs = opts.debounceMs ?? 200
  }

  /**
   * Begin watching. `onChange` receives workspace-relative POSIX paths, deduplicated,
   * at most once per debounce window.
   */
  start(onChange: (paths: string[]) => void): void {
    if (this.#watcher) throw new Error('WatcherService already started')
    this.#onChange = onChange

    this.#watcher = chokidar.watch(this.#root, {
      ignored: IGNORED,
      ignoreInitial: true,
      // The initial scan of a large repo is expensive and we do not need it: the tree
      // is loaded lazily on demand, so we only care about changes from here on.
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    })

    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
      this.#watcher.on(event, (absolute: string) => this.#record(absolute))
    }
  }

  #record(absolute: string): void {
    this.#pending.add(path.relative(this.#root, absolute).split(path.sep).join('/'))
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#flush(), this.#debounceMs)
  }

  #flush(): void {
    this.#timer = null
    if (this.#pending.size === 0) return
    const paths = [...this.#pending]
    this.#pending.clear()
    this.#onChange?.(paths)
  }

  async stop(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    this.#pending.clear()
    this.#onChange = null
    await this.#watcher?.close()
    this.#watcher = null
  }
}
