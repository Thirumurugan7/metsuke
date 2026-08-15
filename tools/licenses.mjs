#!/usr/bin/env node
/*
 * Regenerate THIRD-PARTY-LICENSES.md from what actually ships.
 *
 *   node tools/licenses.mjs          # rewrite the file
 *   node tools/licenses.mjs --check  # fail if it is out of date, for CI
 *
 * Two sets of packages end up in a build and both need attributing:
 *
 *   - runtime dependencies, which electron-builder copies into the app as real
 *     node_modules because electron-vite marks them external, and
 *   - the libraries bundled into the renderer at build time. Those are devDependencies
 *     in package.json, which is a statement about who installs them, not about whether
 *     their code ships. React and Monaco are in every byte of the output.
 *
 * Electron is listed by hand for the same reason: it is a devDependency that is the
 * entire runtime.
 *
 * The walk resolves each dependency the way Node does, upwards through node_modules, so
 * a hoisted or nested copy is found wherever npm actually put it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'THIRD-PARTY-LICENSES.md')

/** devDependencies whose code is compiled into the shipped renderer, plus the runtime. */
const BUNDLED = [
  'electron',
  'react',
  'react-dom',
  'monaco-editor',
  '@xterm/xterm',
  '@xterm/addon-fit',
  'zustand'
]

/*
 * Packages whose dependencies are not walked, because they are not what ships.
 *
 * `npm i electron` pulls a downloader, a caching HTTP client and type packages, all of
 * which run once at install time and none of which reach a build. What ships is the
 * prebuilt binary, and everything inside it is covered by Electron's own LICENSE, which
 * is reproduced below in full. Walking them added twelve packages that are not in the
 * app and made this file a less accurate claim, not a more careful one.
 */
const LEAF = new Set(['electron'])

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENSE-MIT', 'COPYING']

/** Resolve a package directory the way Node would, from `from` upwards. */
function resolvePackage(name, from) {
  let dir = from
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** The declared license, normalised across the several shapes package.json allows. */
function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return 'UNKNOWN'
}

function licenseTextOf(dir) {
  for (const name of LICENSE_FILES) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  }
  return null
}

const collected = new Map()

function walk(name, from) {
  const dir = resolvePackage(name, from)
  if (!dir) {
    // A missing optional or platform-specific package is not worth failing over, but it
    // is worth saying out loud rather than silently attributing nothing.
    console.warn(`  ! ${name} not installed, skipped`)
    return
  }

  const pkg = readJson(path.join(dir, 'package.json'))
  const key = `${pkg.name}@${pkg.version}`
  if (collected.has(key)) return

  collected.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? null,
    text: licenseTextOf(dir)
  })

  if (LEAF.has(pkg.name)) return
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, dir)
}

const manifest = readJson(path.join(root, 'package.json'))
for (const dep of Object.keys(manifest.dependencies ?? {})) walk(dep, root)
for (const dep of BUNDLED) walk(dep, root)

const packages = [...collected.values()].sort((a, b) => a.name.localeCompare(b.name))

const byLicense = new Map()
for (const p of packages) byLicense.set(p.license, (byLicense.get(p.license) ?? 0) + 1)
const summary = [...byLicense.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([license, count]) => `${license} (${count})`)
  .join(', ')

const lines = [
  '# Third-party licenses',
  '',
  `Metsuke ships the ${packages.length} packages below, either copied into the app or`,
  'compiled into the renderer. Each is used under its own license, reproduced in full.',
  '',
  `Licenses in use: ${summary}.`,
  '',
  'Regenerate with `npm run licenses`. Do not edit by hand: it is generated from the',
  'installed tree, so an edit is a claim about what shipped that nothing checks.',
  '',
  '## Packages',
  '',
  '| Package | Version | License |',
  '|---|---|---|',
  ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
  '',
  '## Full texts',
  ''
]

for (const p of packages) {
  lines.push(`### ${p.name} ${p.version}`, '')
  lines.push(`License: ${p.license}`)
  if (p.homepage) lines.push('', `Source: ${p.homepage.replace(/^git\+/, '').replace(/\.git$/, '')}`)
  lines.push('')
  if (p.text) {
    lines.push('```', p.text, '```', '')
  } else {
    // Saying so is the honest option. Claiming a text we never found is not.
    lines.push(
      `No license file was published in this package. The \`license\` field of its`,
      `package.json declares ${p.license}.`,
      ''
    )
  }
}

const output = lines.join('\n')

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== output) {
    console.error('THIRD-PARTY-LICENSES.md is out of date. Run: npm run licenses')
    process.exit(1)
  }
  console.log(`THIRD-PARTY-LICENSES.md is current (${packages.length} packages).`)
} else {
  fs.writeFileSync(OUT, output)
  console.log(`Wrote THIRD-PARTY-LICENSES.md: ${packages.length} packages, ${summary}.`)
}
