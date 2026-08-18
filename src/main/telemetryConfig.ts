/**
 * Where telemetry goes, decided at build time.
 *
 * Baked in by electron-vite from METSUKE_TELEMETRY_ENDPOINT, which release CI sets and a
 * dev machine does not. That default matters: with no endpoint the whole subsystem is
 * inert regardless of consent, so working on the editor never sends anything anywhere,
 * and a fork that builds this without setting it gets an app that quietly collects
 * nothing rather than one that phones home to us.
 *
 * The runtime environment variable wins when present, which is how the ingest server is
 * tested against a local build.
 */
declare const __TELEMETRY_ENDPOINT__: string

const baked = typeof __TELEMETRY_ENDPOINT__ === 'string' ? __TELEMETRY_ENDPOINT__ : ''

export const TELEMETRY_ENDPOINT = process.env['METSUKE_TELEMETRY_ENDPOINT'] ?? baked
