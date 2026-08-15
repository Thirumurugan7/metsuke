import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FileService } from './FileService'

describe('FileService', () => {
  let root: string
  let outside: string
  let files: FileService

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-fs-'))
    root = path.join(base, 'workspace')
    outside = path.join(base, 'outside')
    await fs.mkdir(root)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.txt'), 'do not read me\n')
    files = new FileService(root)
  })

  afterEach(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true })
  })

  describe('the path jail', () => {
    it('refuses to traverse out with ..', async () => {
      await expect(files.read('../outside/secret.txt')).rejects.toThrow(/escapes the workspace/)
    })

    it('refuses a deeply nested traversal', async () => {
      await expect(files.read('a/b/../../../outside/secret.txt')).rejects.toThrow(
        /escapes the workspace/
      )
    })

    it('refuses an absolute path outside the workspace', async () => {
      await expect(files.read(path.join(outside, 'secret.txt'))).rejects.toThrow(
        /escapes the workspace/
      )
    })

    it('refuses to follow a symlink that points outside', async () => {
      await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
      await expect(files.read('link.txt')).rejects.toThrow(/escapes the workspace/)
    })

    it('refuses to write through a symlinked directory', async () => {
      await fs.symlink(outside, path.join(root, 'escape'))
      await expect(files.write('escape/planted.txt', 'x')).rejects.toThrow(/escapes the workspace/)
      await expect(fs.access(path.join(outside, 'planted.txt'))).rejects.toThrow()
    })

    it('refuses to delete the workspace root', async () => {
      await expect(files.delete('')).rejects.toThrow(/workspace root/)
      await expect(files.delete('.')).rejects.toThrow(/workspace root/)
    })

    it('allows a path that merely looks like traversal but stays inside', async () => {
      await files.write('a/b/c.txt', 'inside')
      expect(await files.read('a/b/../b/c.txt')).toBe('inside')
    })
  })

  describe('list', () => {
    it('sorts directories before files, each alphabetically', async () => {
      await files.write('zebra.txt', '')
      await files.write('apple.txt', '')
      await files.create('src', true)
      await files.create('docs', true)

      expect((await files.list('')).map((e) => e.name)).toEqual([
        'docs',
        'src',
        'apple.txt',
        'zebra.txt'
      ])
    })

    it('hides node_modules and .git', async () => {
      await files.create('node_modules', true)
      await files.create('.git', true)
      await files.write('keep.txt', '')

      expect((await files.list('')).map((e) => e.name)).toEqual(['keep.txt'])
    })

    it('returns paths relative to the workspace root', async () => {
      await files.write('src/deep/file.ts', '')
      const [entry] = await files.list('src/deep')
      expect(entry.path).toBe('src/deep/file.ts')
    })
  })

  describe('mutations', () => {
    it('creates parent directories on write', async () => {
      await files.write('deeply/nested/new.txt', 'hi')
      expect(await files.read('deeply/nested/new.txt')).toBe('hi')
    })

    it('refuses to clobber an existing file with create', async () => {
      await files.write('taken.txt', 'original')
      await expect(files.create('taken.txt', false)).rejects.toThrow()
      expect(await files.read('taken.txt')).toBe('original')
    })

    it('renames across directories', async () => {
      await files.write('old/a.txt', 'body')
      await files.rename('old/a.txt', 'new/b.txt')

      expect(await files.read('new/b.txt')).toBe('body')
      await expect(files.read('old/a.txt')).rejects.toThrow()
    })

    it('deletes a directory recursively', async () => {
      await files.write('tree/nested/deep.txt', 'x')
      await files.delete('tree')
      await expect(files.read('tree/nested/deep.txt')).rejects.toThrow()
    })

    it('rejects reading a directory as a file', async () => {
      await files.create('adir', true)
      await expect(files.read('adir')).rejects.toThrow(/Not a file/)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      await files.write('src/one.ts', 'const needle = 1\nother line\n')
      await files.write('src/two.ts', 'no match here\n')
      await files.write('src/three.ts', 'NEEDLE uppercase\n')
    })

    it('finds matches with file, line number, and text', async () => {
      const results = await files.search('needle', { caseSensitive: true })
      expect(results).toEqual([{ path: 'src/one.ts', line: 1, text: 'const needle = 1' }])
    })

    it('is case-insensitive by default', async () => {
      const results = await files.search('needle')
      expect(results.map((r) => r.path).sort()).toEqual(['src/one.ts', 'src/three.ts'])
    })

    it('treats the query literally unless regex is set', async () => {
      await files.write('src/dots.ts', 'a.b\naxb\n')
      const literal = await files.search('a.b')
      expect(literal.filter((r) => r.path === 'src/dots.ts')).toHaveLength(1)

      const regex = await files.search('a.b', { regex: true })
      expect(regex.filter((r) => r.path === 'src/dots.ts')).toHaveLength(2)
    })

    it('honours the match limit', async () => {
      await files.write('many.txt', 'hit\n'.repeat(50))
      expect(await files.search('hit', { limit: 5 })).toHaveLength(5)
    })

    it('returns nothing for an empty query', async () => {
      expect(await files.search('')).toEqual([])
    })
  })
})

describe('FileService.replace', () => {
  let dir: string
  let files: FileService

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metsuke-replace-'))
    files = new FileService(dir)
    await fs.writeFile(path.join(dir, 'a.txt'), 'red fish\nred fish\nblue fish\n')
    await fs.mkdir(path.join(dir, 'sub'))
    await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'a red herring\n')
    await fs.writeFile(path.join(dir, 'untouched.txt'), 'nothing here\n')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('replaces every occurrence, including several on one line', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'red red red\n')
    const result = await files.replace('red', 'green')

    expect(result.replacements).toBeGreaterThanOrEqual(3)
    // Without a global pattern this would fix only the first hit and report success.
    expect(await files.read('a.txt')).toBe('green green green\n')
  })

  it('reaches across directories and reports what it touched', async () => {
    const result = await files.replace('red', 'green')

    expect(result.files).toBe(2)
    expect(await files.read('a.txt')).toBe('green fish\ngreen fish\nblue fish\n')
    expect(await files.read('sub/b.txt')).toBe('a green herring\n')
  })

  it('leaves files without a match completely alone', async () => {
    const before = await fs.stat(path.join(dir, 'untouched.txt'))
    await files.replace('red', 'green')
    const after = await fs.stat(path.join(dir, 'untouched.txt'))

    expect(await files.read('untouched.txt')).toBe('nothing here\n')
    // Not even an mtime change, so the watcher has nothing to announce.
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('treats the query literally unless asked for a regex', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'a.b and axb\n')
    await files.replace('a.b', 'X')
    // A literal dot, not "any character", so axb survives.
    expect(await files.read('a.txt')).toBe('X and axb\n')
  })

  it('honours a real regex, with capture groups', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'version 1.2.3\n')
    await files.replace('version (\\d+)', 'v$1', { regex: true })
    expect(await files.read('a.txt')).toBe('v1.2.3\n')
  })

  it('is case insensitive by default and exact when asked', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'Red red RED\n')

    await files.replace('red', 'x', { caseSensitive: true })
    expect(await files.read('a.txt')).toBe('Red x RED\n')

    // Only the two that the case-sensitive pass left behind: the middle word is 'x' now.
    await files.replace('red', 'y')
    expect(await files.read('a.txt')).toBe('y x y\n')
  })

  it('confines itself to the given files when asked', async () => {
    const result = await files.replace('red', 'green', { paths: ['sub/b.txt'] })

    expect(result.files).toBe(1)
    expect(await files.read('sub/b.txt')).toBe('a green herring\n')
    // The other match is untouched, which is the whole point of passing paths.
    expect(await files.read('a.txt')).toBe('red fish\nred fish\nblue fish\n')
  })

  it('does nothing at all for an empty query', async () => {
    expect(await files.replace('', 'x')).toEqual({ files: 0, replacements: 0 })
    expect(await files.read('a.txt')).toBe('red fish\nred fish\nblue fish\n')
  })

  it('refuses to escape the workspace through a path it was handed', async () => {
    await expect(files.replace('red', 'green', { paths: ['../outside.txt'] })).resolves.toEqual({
      files: 0,
      replacements: 0
    })
  })
})
