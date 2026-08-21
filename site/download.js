/*
 * Download links and platform detection.
 *
 * Asset URLs come from the latest GitHub release at page load, so the page never needs
 * editing when a version ships. If the API cannot be reached, because of rate limiting,
 * no network, or no release yet, every link falls back to the releases page. That costs
 * the visitor one extra click and is never wrong.
 */

// ── Where releases come from ─────────────────────────────────────────────────
// The download endpoint on the telemetry deployment, not GitHub directly. The repo is
// private, so its release assets need an authenticated request; that endpoint makes it
// with a read-only token and hands back the signed URL GitHub replies with. Set it in
// config.js. Empty means downloads are not wired up yet, and every button then says so
// rather than pointing at a 404.
const DOWNLOAD_API = window.METSUKE_DOWNLOAD_API ?? ''
// ─────────────────────────────────────────────────────────────────────────────

/** Where a button goes when there is nothing to download yet. */
const RELEASES_URL = DOWNLOAD_API || '#download'
const LATEST_API = DOWNLOAD_API

/** Match a release asset by platform and architecture. */
const MATCHERS = {
  'dmg-arm64': (n) => n.endsWith('.dmg') && /arm64/i.test(n),
  'dmg-x64': (n) => n.endsWith('.dmg') && /x64|intel/i.test(n),
  exe: (n) => n.endsWith('.exe'),
  appimage: (n) => n.toLowerCase().endsWith('.appimage'),
  deb: (n) => n.endsWith('.deb')
}

const PLATFORMS = {
  mac: { label: 'Download for macOS', asset: (arch) => `dmg-${arch}`, name: 'macOS' },
  windows: { label: 'Download for Windows', asset: () => 'exe', name: 'Windows' },
  linux: { label: 'Download for Linux', asset: () => 'appimage', name: 'Linux' }
}

/** Best guess at the visitor's platform. Used only to promote one download. */
function detectPlatform() {
  const hay = `${navigator.userAgent} ${navigator.userAgentData?.platform ?? navigator.platform ?? ''}`
  if (/Mac|iPhone|iPad/i.test(hay)) return { os: 'mac', arch: isAppleSilicon() ? 'arm64' : 'x64' }
  if (/Win/i.test(hay)) return { os: 'windows', arch: 'x64' }
  if (/Linux|X11/i.test(hay)) return { os: 'linux', arch: 'x64' }
  return { os: null, arch: 'x64' }
}

/*
 * Apple silicon does not appear in the user agent. The WebGL renderer string is the
 * usual tell. When it is unavailable the guess is Apple silicon, which is both the more
 * common machine now and the harmless answer, since both buttons sit in the table below.
 */
function isAppleSilicon() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
    if (/Apple M\d|Apple GPU/i.test(renderer)) return true
    if (/Intel/i.test(renderer)) return false
  } catch {
    /* WebGL blocked, fall through to the default. */
  }
  return true
}

async function init() {
  const { os, arch } = detectPlatform()
  const platform = os ? PLATFORMS[os] : null

  const primary = document.getElementById('primary-download')
  const label = document.getElementById('primary-label')
  const availability = document.getElementById('availability')

  // Promote the visitor's platform straight away. Asset URLs arrive later, so the
  // button points at the releases page in the meantime rather than being dead.
  if (platform && label) label.textContent = platform.label
  if (platform && availability) {
    const others = Object.entries(PLATFORMS)
      .filter(([key]) => key !== os)
      .map(([, value]) => value.name)
    availability.textContent = `Also available for ${others.join(' and ')}`
  }
  if (primary) primary.href = RELEASES_URL

  let release = null
  if (LATEST_API) {
    try {
      const response = await fetch(LATEST_API, { headers: { accept: 'application/json' } })
      if (response.ok) release = await response.json()
    } catch {
      /* Offline, or the endpoint is not up yet. The fallback below already applies. */
    }
  }

  const assets = release?.assets ?? []
  // Relative to the download endpoint, since that is what serves them.
  const base = LATEST_API.replace(/\/download\/?$/, '')
  const urlFor = (key) => {
    const asset = assets.find((a) => MATCHERS[key]?.(a.name))
    return asset ? `${base}${asset.url}` : undefined
  }

  const version = document.getElementById('version')
  if (version && release?.version) version.textContent = release.version

  for (const link of document.querySelectorAll('[data-asset]')) {
    const url = urlFor(link.dataset.asset)
    link.href = url ?? RELEASES_URL
    if (!url) link.title = LATEST_API ? 'This build is not in the latest release yet' : 'No release published yet'
  }

  if (platform) {
    const url = urlFor(platform.asset(arch))
    if (url && primary) primary.href = url
  }
}

init()
