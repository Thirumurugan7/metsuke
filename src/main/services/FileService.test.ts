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
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'codeeditor-fs-'))
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
