import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import type { DirEntry } from '@shared/ipc'

/** Directories never worth walking into for a tree or a search. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'out',
  'build',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

/** Above this, we treat a file as binary/too-large and refuse to load it into an editor. */
const MAX_READ_BYTES = 10 * 1024 * 1024

export class PathJailError extends Error {
  constructor(requested: string) {
    super(`Path escapes the workspace: ${requested}`)
    this.name = 'PathJailError'
  }
}

/**
 * Filesystem access for a single workspace. Every public method takes a path relative
 * to the workspace root and resolves it through `#resolve`, which is the only place
 * that produces an absolute path — so there is exactly one gate to audit.
 */
export class FileService {
  readonly root: string

  constructor(root: string) {
    // Canonicalised once, because the jail compares resolved paths against it. On macOS
    // /var is itself a symlink to /private/var, so an uncanonicalised root would make
    // every real path under it look like an escape.
    const resolved = path.resolve(root)
    try {
      this.root = realpathSync(resolved)
    } catch {
      this.root = resolved // folder does not exist yet; the lexical jail still applies
    }
  }

  /**
   * Turn a workspace-relative path into an absolute one, refusing anything that
   * escapes the root via `..`, an absolute path, or a symlink pointing outside.
   */
  #resolve(relative: string): string {
    const absolute = path.resolve(this.root, relative)
    const rel = path.relative(this.root, absolute)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new PathJailError(relative)
    return absolute
  }

  /**
   * Resolve symlinks and re-check the jail, so a link inside the workspace cannot be
   * used to read or write outside it.
   *
   * The target often does not exist yet (any create or write), and `realpath` fails on
   * a missing path — so we canonicalise the nearest ancestor that does exist and
   * re-attach the remaining segments. That still catches a symlinked *parent*
   * directory, which resolving only the leaf would miss.
   */
  async #resolveReal(relative: string): Promise<string> {
    const absolute = this.#resolve(relative)

    let existing = absolute
    const trailing: string[] = []
    for (;;) {
      try {
        await fs.lstat(existing)
        break
      } catch {
        const parent = path.dirname(existing)
        if (parent === existing) break // reached the filesystem root
        trailing.unshift(path.basename(existing))
        existing = parent
      }
    }

    const real = await fs.realpath(existing).catch(() => existing)
    const resolved = path.resolve(real, ...trailing)

    const rel = path.relative(this.root, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new PathJailError(relative)
    return resolved
  }

  /** Workspace-relative, POSIX-separated path for an absolute one. */
  toRelative(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join('/')
  }

  /** One level of the tree, directories first then files, each alphabetical. */
  async list(dir: string): Promise<DirEntry[]> {
    const absolute = await this.#resolveReal(dir)
    const entries = await fs.readdir(absolute, { withFileTypes: true })
    const prefix = dir ? `${dir.replace(/\/$/, '')}/` : ''

    return entries
      .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
      .map((e) => ({
        path: `${prefix}${e.name}`,
        name: e.name,
        isDirectory: e.isDirectory()
      }))
      .sort((a, b) =>
        a.isDirectory === b.isDirectory
          ? a.name.localeCompare(b.name)
          : a.isDirectory
            ? -1
            : 1
      )
  }

  async read(relative: string): Promise<string> {
    const absolute = await this.#resolveReal(relative)
    const stat = await fs.stat(absolute)
    if (stat.isDirectory()) throw new Error(`Not a file: ${relative}`)
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${(stat.size / 1024 / 1024).toFixed(1)}MB, larger than the ${MAX_READ_BYTES / 1024 / 1024}MB editor limit`
      )
    }
    return fs.readFile(absolute, 'utf8')
  }

  async write(relative: string, contents: string): Promise<void> {
    const absolute = await this.#resolveReal(relative)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, contents, 'utf8')
  }

  async create(relative: string, isDirectory: boolean): Promise<void> {
    const absolute = await this.#resolveReal(relative)
    if (isDirectory) {
      await fs.mkdir(absolute, { recursive: true })
      return
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    // wx so creating over an existing file is an error rather than a silent truncate.
    const handle = await fs.open(absolute, 'wx')
    await handle.close()
  }

  async rename(from: string, to: string): Promise<void> {
    const absFrom = await this.#resolveReal(from)
    const absTo = await this.#resolveReal(to)
    await fs.mkdir(path.dirname(absTo), { recursive: true })
    await fs.rename(absFrom, absTo)
  }

  async delete(relative: string): Promise<void> {
    if (relative === '' || relative === '.') throw new Error('Refusing to delete the workspace root')
    const absolute = await this.#resolveReal(relative)
    await fs.rm(absolute, { recursive: true, force: true })
  }

  /**
   * Every file path in the workspace, for quick-open. Capped so a huge repo cannot
   * stall the UI; the cap is generous enough that hitting it is unusual.
   */
  async allFiles(limit = 20_000): Promise<string[]> {
    const out: string[] = []

    const walk = async (dir: string): Promise<void> => {
      if (out.length >= limit) return
      let entries: DirEntry[]
      try {
        entries = await this.list(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= limit) return
        if (entry.isDirectory) await walk(entry.path)
        else out.push(entry.path)
      }
    }

    await walk('')
    return out
  }

  /** Recursive content search, breadth-limited and capped at `limit` matches. */
  async search(
    query: string,
    opts: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {}
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    const { regex = false, caseSensitive = false, limit = 500 } = opts
    if (!query) return []

    const pattern = regex
      ? new RegExp(query, caseSensitive ? '' : 'i')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i')

    const results: Array<{ path: string; line: number; text: string }> = []

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= limit) return
      let entries: DirEntry[]
      try {
        entries = await this.list(dir)
      } catch {
        return // unreadable directory, skip rather than fail the whole search
      }

      for (const entry of entries) {
        if (results.length >= limit) return
        if (entry.isDirectory) {
          await walk(entry.path)
          continue
        }
        let contents: string
        try {
          contents = await this.read(entry.path)
        } catch {
          continue // binary, too large, or unreadable
        }
        // A NUL byte in the first chunk is a reliable enough binary signal.
        if (contents.slice(0, 8000).includes('\0')) continue

        const lines = contents.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push({ path: entry.path, line: i + 1, text: lines[i].slice(0, 500) })
            if (results.length >= limit) return
          }
        }
      }
    }

    await walk('')
    return results
  }

  /**
   * Replace every match of `query` across the workspace, or in the given files.
   *
   * Deliberately built on the same pattern construction as `search`, so what you replace
   * is exactly what you were shown. A separate implementation here would eventually
   * drift, and the failure mode of that drift is editing files the user never saw
   * listed, which is not a mistake worth risking to save a few lines.
   *
   * Writes are per file and only when the content actually changed, so a run that
   * matches nothing touches nothing and leaves no mtime churn for the watcher to
   * announce.
   */
  async replace(
    query: string,
    replacement: string,
    opts: { regex?: boolean; caseSensitive?: boolean; paths?: string[] } = {}
  ): Promise<{ files: number; replacements: number }> {
    const { regex = false, caseSensitive = false, paths } = opts
    if (!query) return { files: 0, replacements: 0 }

    /*
     * Global, unlike the search pattern: search only asks whether a line matches, while
     * replace has to reach every occurrence on it. Without /g this would silently fix
     * only the first hit per line and report success.
     */
    const flags = `g${caseSensitive ? '' : 'i'}`
    const pattern = regex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

    const targets = paths?.length ? paths : [...new Set((await this.search(query, { ...opts, limit: 10_000 })).map((hit) => hit.path))]

    let files = 0
    let replacements = 0

    for (const file of targets) {
      let contents: string
      try {
        contents = await this.read(file)
      } catch {
        continue // unreadable, binary, or gone since the search
      }
      if (contents.slice(0, 8000).includes('\0')) continue

      // Count before replacing: a global regex is stateful, and reusing it to both count
      // and replace would skip every other match through lastIndex.
      const hits = contents.match(pattern)?.length ?? 0
      if (hits === 0) continue

      const next = contents.replace(pattern, replacement)
      if (next === contents) continue

      await this.write(file, next)
      files++
      replacements += hits
    }

    return { files, replacements }
  }
}
