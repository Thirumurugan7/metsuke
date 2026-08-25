/*
 * Ad-hoc sign the macOS bundle.
 *
 * Electron ships its binary linker-signed. electron-builder then renames it, rewrites
 * Info.plist and adds resources, and with no signing identity available it does not
 * re-sign — so the bundle keeps a signature that no longer describes its contents.
 * macOS reports that as "Metsuke is damaged and can't be opened", which sounds like a
 * corrupt download and is not one. On Apple silicon a valid signature is mandatory, so
 * removing the quarantine flag does not help either: the app still will not launch.
 *
 * An ad-hoc signature costs nothing, needs no certificate and no Apple account, and
 * makes the bundle internally consistent. It does not make Gatekeeper trust the app —
 * that needs Developer ID and notarisation — but it turns "damaged" into the ordinary
 * unidentified-developer prompt that right click, Open can get past.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // If a real identity is configured, electron-builder has already signed properly and
  // this would replace a Developer ID signature with an ad-hoc one. Leave it alone.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${path.basename(app)}`)
}
