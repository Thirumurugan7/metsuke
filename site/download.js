/*
 * Download links and platform detection.
 *
 * Asset URLs are built from the latest GitHub release rather than hardcoded, so the
 * page never needs editing when a version ships. If the API is unreachable — rate
 * limited, offline, no release yet — every link falls back to the releases page, which
 * is always correct even if it costs the visitor one extra click.
 */

// ── Set this to your repository ──────────────────────────────────────────────
const REPO = 'OWNER/REPO'
// ─────────────────────────────────────────────────────────────────────────────

const RELEASES_URL = `https://github.com/${REPO}/releases`
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`

/** Match a release asset by platform and architecture. */
const MATCHERS = {
  'dmg-arm64': (n) => n.endsWith('.dmg') && /arm64/i.test(n),
  'dmg-x64': (n) => n.endsWith('.dmg') && /x64|intel/i.test(n),
  exe: (n) => n.endsWith('.exe'),
  appimage: (n) => n.toLowerCase().endsWith('.appimage'),
  deb: (n) => n.endsWith('.deb')
}

/** Best guess at the visitor's platform, used only to promote one download. */
function detectPlatform() {
  const ua = navigator.userAgent
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ''
  const hay = `${ua} ${platform}`

  if (/Mac|iPhone|iPad/i.test(hay)) {
    // Apple silicon does not announce itself in the UA. A WebGL renderer string is
    // the usual tell; when it is unavailable we default to Apple silicon, which is
    // both the more common machine now and the harmless guess (Intel users see both
    // buttons right below).
    return { os: 'mac', arch: isAppleSilicon() ? 'arm64' : 'x64' }
  }
  if (/Win/i.test(hay)) return { os: 'windows', arch: 'x64' }
  if (/Linux|X11/i.test(hay)) return { os: 'linux', arch: 'x64' }
  return { os: null, arch: 'x64' }
}

function isAppleSilicon() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
    if (/Apple M\d|Apple GPU/i.test(renderer)) return true
    if (/Intel/i.test(renderer)) return false
  } catch {
    /* WebGL blocked; fall through to the default. */
  }
  return true
}

const LABELS = {
  mac: { icon: '⌘', label: 'Download for macOS', asset: (arch) => `dmg-${arch}` },
  windows: { icon: '⊞', label: 'Download for Windows', asset: () => 'exe' },
  linux: { icon: '🐧', label: 'Download for Linux', asset: () => 'appimage' }
}

async function init() {
  const { os, arch } = detectPlatform()

  // Promote the visitor's platform immediately; asset URLs are filled in once the
  // release data arrives, so the button is never dead in the meantime.
  const primary = document.getElementById('primary-download')
  const chosen = os ? LABELS[os] : null
  if (chosen) {
    document.getElementById('primary-icon').textContent = chosen.icon
    document.getElementById('primary-label').textContent = chosen.label
    document.getElementById('other-platforms').innerHTML = otherPlatformsText(os)
    document.querySelector(`.dl-row[data-os="${os}"]`)?.scrollIntoView?.({ block: 'nearest' })
  } else {
    document.getElementById('primary-label').textContent = 'Download'
  }
  primary.href = RELEASES_URL

  let release = null
  try {
    const response = await fetch(LATEST_API, { headers: { accept: 'application/vnd.github+json' } })
    if (response.ok) release = await response.json()
  } catch {
    /* Offline or blocked: the releases-page fallback already applies. */
  }

  const assets = release?.assets ?? []
  const urlFor = (key) => assets.find((a) => MATCHERS[key]?.(a.name))?.browser_download_url

  if (release?.tag_name) {
    document.getElementById('version').textContent = release.tag_name.replace(/^v/, '')
  }

  for (const link of document.querySelectorAll('[data-asset]')) {
    const url = urlFor(link.dataset.asset)
    link.href = url ?? RELEASES_URL
    if (!url) link.title = 'No build for this platform in the latest release yet'
  }

  if (chosen) {
    const url = urlFor(chosen.asset(arch))
    if (url) primary.href = url
  }
}

function otherPlatformsText(os) {
  const all = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }
  const others = Object.entries(all)
    .filter(([key]) => key !== os)
    .map(([, name]) => `<a href="#download">${name}</a>`)
  return `Also for ${others.join(' and ')}`
}

init()
