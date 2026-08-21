/** Create the tables. Idempotent, so running it twice is not a mistake. */
import { getPool, migrate } from './db.js'

const db = getPool()
await migrate(db)
console.log('schema is up to date')
await db.end()
