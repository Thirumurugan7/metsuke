import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SystemCheck } from '@shared/ipc'

const exec = promisify(execFile)

/**
 * Ask a tool for its version to find out whether it is usable.
 *
 * Two things matter here and both are easy to get wrong.
 *
 * It runs the tool for real rather than asking `which`, because a shim on PATH that
 * fails to execute is worse than an absent one: it looks installed and then dies the
 * moment a terminal tries to use it.
 *
 * It runs through the user's login shell on macOS and Linux, because a GUI app does not
 * inherit the PATH that nvm, homebrew or asdf set up in a shell profile. Probing with
 * the app's own PATH reports `claude` missing on machines where the editor's terminal
 * can run it perfectly well, and a welcome screen that lies about the one dependency is
 * worse than no welcome screen. The terminal spawns a login shell too, so this matches
 * what the user will actually get.
 */
async function probe(command: string): Promise<{ installed: boolean; version: string | null }> {
  const shell = process.env['SHELL'] ?? '/bin/zsh'

  try {
    const { stdout } =
      process.platform === 'win32'
        ? await exec(command, ['--version'], { timeout: 6000 })
        : await exec(shell, ['-lic', `${command} --version`], {
            timeout: 6000,
            env: { ...process.env, TERM: 'dumb' }
          })

    // A login shell can print its own banner first, so take the line that looks like a
    // version rather than blindly taking the first.
    const lines = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const version = lines.find((line) => /\d+\.\d+/.test(line)) ?? lines[0] ?? null

    return { installed: true, version: version ? version.slice(0, 80) : null }
  } catch {
    return { installed: false, version: null }
  }
}

let cached: SystemCheck | null = null

/**
 * What the machine has. Cached, because a login shell costs real time to start and the
 * welcome screen asks on every mount.
 */
export async function systemCheck(): Promise<SystemCheck> {
  if (cached) return cached

  const [claude, git] = await Promise.all([probe('claude'), probe('git')])
  cached = { claude, git, platform: process.platform }
  return cached
}

/** Forget the cached answer, so someone who installs Claude mid-session can re-check. */
export function clearSystemCheck(): void {
  cached = null
}
