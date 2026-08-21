import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load the repository's .env before the tests run.
 *
 * These are integration tests against real Postgres, so DATABASE_URL is not optional —
 * and without this, `npm run test:server` failed with "DATABASE_URL is not set" for
 * anyone who had not exported it by hand in that shell, which is a confusing way to be
 * told to read a file that already has the answer in it.
 *
 * Deliberately not a dotenv dependency: it is fifteen lines, and the parsing is only
 * interesting in one place — values are quoted in .env because the connection URL
 * contains an ampersand.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', '.env')

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue

    const [, key, raw] = match
    // Strip one layer of matching quotes, and leave anything already exported alone.
    const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

if (!process.env['DATABASE_URL']) {
  throw new Error(
    'DATABASE_URL is not set and no .env was found at the repository root.\n' +
      'These tests run against real Postgres — see .env.example.'
  )
}
