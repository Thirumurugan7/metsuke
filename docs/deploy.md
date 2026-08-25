# Deploying

Three pieces, three homes. They are separate on purpose: the only one that needs a disk
is the one that keeps data, and the only one that needs a CDN is the one everybody hits.

| Piece | Where | Why there |
|---|---|---|
| The website | Vercel | Three static files, no build. Free, instant, and a domain is one click. |
| The installers | GitHub Releases, in a *separate public repo* | Free, unmetered, on a CDN, and the update client speaks it natively. |
| Telemetry + dashboard | A small VM with a disk | SQLite is a file. Serverless hosts have no persistent one. |

## The installers go on GitHub Releases

This is not a preference, it is what the code already does:

- `site/download.js` reads `api.github.com/repos/OWNER/REPO/releases/latest` and picks the
  right asset per platform and architecture.
- `electron-builder.yml` has `publish: provider: github`.
- `electron-updater` in the app reads `latest-mac.yml`, `latest.yml` and
  `latest-linux.yml` from the release, which is why the workflow uploads them.

**The code repository is private, so releases go somewhere else.** Assets on a private
repo need an authenticated request: download links, and the update feed the app polls,
would 404 for everybody.

The answer is a second repository, `Thirumurugan7/metsuke`, public, containing no
code — releases and nothing else. `electron-builder.yml` publishes there, `download.js`
looks there, and auto-update reads its feed from there. Nothing else changes, it stays
free and unmetered, and the source stays private. Object storage (R2, S3) would also work
but means rewriting the update client onto a generic provider for no gain.

That public repo is also the only public face this project has, so it is the sensible
home for the issue tracker and the third-party license file.

Do not host installers on Vercel. They are 100MB+ each, four per release, and it is not a
file host.

## The website on Vercel

`vercel.json` at the repo root does the whole configuration, so there is nothing to set in
the dashboard beyond connecting the repo.

It exists mostly to stop Vercel being helpful. The repo root is an Electron app: left to
its own detection, Vercel would run `npm install` (downloading Electron and rebuilding
node-pty), then `npm run build` (building the desktop app), and deploy none of it. Both
commands are stubbed out and `outputDirectory` points at `site`.

It also sets a strict Content-Security-Policy, which the site can afford because it has no
inline script or style anywhere. `connect-src` allows `api.github.com`, and that one entry
is load-bearing: without it the release lookup is blocked and every download button
silently falls back to the releases page.

1. Vercel → Add New Project → import the repo.
2. **Set Root Directory to `site`.** That is the one setting that matters, and it is why
   `vercel.json` lives in `site/` rather than at the repo root: Vercel reads the config
   from whichever directory it was pointed at.
3. Leave everything else alone. There is no `package.json` in `site/`, so nothing tries to
   build the Electron app sitting one level up.
4. Deploy. Add a domain if you have one.

Pushes to the default branch redeploy. Pull requests get preview URLs.

## Telemetry, if you want it

**Yes, separately, and only when you want it.** Vercel functions are stateless with no
persistent disk, so the SQLite file would vanish between invocations. Three options:

- **Do nothing.** The app compiles in an empty endpoint and collects nothing, whatever
  anyone consents to. Costs nothing and blocks nothing else in this document.
- **The cheapest VM with a volume** — Fly.io, Railway, or a $5 VPS behind Caddy. This is
  what `server/` is written for: one process, one file, one backup.
- **Keep it on Vercel** by swapping SQLite for a hosted Postgres (Neon, Supabase) and
  running ingest as a function. That is a real rewrite of `server/src/db.ts`, worth it only
  if you would rather have no server to patch.

See `server/README.md`. Two settings make it real: `DASHBOARD_TOKEN` on the server, and
`METSUKE_TELEMETRY_ENDPOINT` as a repository secret so release builds compile the endpoint
in. Until both exist the app collects nothing, whatever anyone consents to.

## Shipping a version

```bash
npm version minor        # or patch/major; writes package.json and tags
git push --follow-tags
```

The tag starts `.github/workflows/release.yml`, which builds on macOS, Windows and Linux
in parallel — they cannot cross-compile, because node-pty is native — and attaches the
installers plus the update feeds to a GitHub Release. The website needs no edit: it reads
the latest release at page load.

The first run of that workflow has never happened. Expect to fix something.

## Signing and notarisation

Until this is done, macOS tells every user *"Apple could not verify Metsuke is free of
malware"*, and since macOS 15 the right click, Open shortcut no longer gets past it. The
only route left in the interface is System Settings, Privacy and Security, Open Anyway.
Most people will not do that.

The config is already in place. `mac.notarize` is on, and `build/afterPack.cjs` ad-hoc
signs the bundle when no real identity exists, which is what stops macOS calling the app
damaged. Neither needs changing.

What is missing is the certificate:

1. Enrol in the Apple Developer Program, $99 a year. Individual enrolment usually clears
   in a day or two; business enrolment needs a D-U-N-S number and takes longer.
2. Xcode, Settings, Accounts, Manage Certificates, plus, **Developer ID Application**.
   Not "Mac App Store" and not "Development", neither of which works for direct download.
3. Export it from Keychain Access, My Certificates, as a `.p12` with a password, then
   `base64 -i Certificates.p12 | pbcopy`.
4. Generate an app specific password at appleid.apple.com, under Sign-In and Security.
   The normal Apple password is rejected by notarisation.
5. Add five repository secrets: `CSC_LINK` (the base64 blob), `CSC_KEY_PASSWORD`,
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and pass them into the
   build step in `.github/workflows/release.yml`.

Check the result on a downloaded build rather than in the CI log:

```bash
spctl -a -vvv -t install /Applications/Metsuke.app   # want: source=Notarized Developer ID
xcrun stapler validate /Applications/Metsuke.app     # want: The validate action worked!
```

`codesign -dv` alone is not enough. It passes on a signed but un-notarised app, which is
exactly the build that still gets stopped on a machine that has never seen it.

Windows is a separate purchase. An OV certificate still shows SmartScreen until reputation
accrues over hundreds of installs; an EV certificate clears it immediately and needs a
hardware token or cloud HSM.
