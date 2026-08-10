import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Workspace } from '@shared/ipc'
import { FileService } from './services/FileService'
import { GitService } from './services/GitService'
import { WatcherService } from './services/WatcherService'

/**
 * Everything that is scoped to one open folder. Opening a different folder tears the
 * whole thing down and builds a new one, so there is no partially-swapped state.
 */
export class WorkspaceContext {
  readonly info: Workspace
  readonly files: FileService
  readonly git: GitService | null
  readonly watcher: WatcherService

  private constructor(info: Workspace, files: FileService, git: GitService | null) {
    this.info = info
    this.files = files
    this.git = git
    this.watcher = new WatcherService(info.root)
  }

  static async open(root: string): Promise<WorkspaceContext> {
    const resolved = path.resolve(root)
    const stat = await fs.stat(resolved).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`Not a folder: ${resolved}`)

    const isGitRepo = await GitService.isRepo(resolved)
    const info: Workspace = { root: resolved, name: path.basename(resolved), isGitRepo }

    return new WorkspaceContext(info, new FileService(resolved), isGitRepo ? new GitService(resolved) : null)
  }

  /** Git service or a clear error — callers should not have to null-check everywhere. */
  requireGit(): GitService {
    if (!this.git) throw new Error(`${this.info.name} is not a git repository`)
    return this.git
  }

  async dispose(): Promise<void> {
    await this.watcher.stop()
  }
}
