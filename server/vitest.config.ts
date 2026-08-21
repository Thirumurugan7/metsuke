import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * These are integration tests against real Postgres, over the internet. Every query
     * is a round trip to Neon, and a test that writes five envelopes is five
     * transactions, which is seconds rather than milliseconds. The default 5s timeout
     * fails them for being far away rather than for being wrong.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /* One file at a time: they share a database, and a truncate in one would empty
       another's fixtures halfway through. */
    fileParallelism: false
  }
})
