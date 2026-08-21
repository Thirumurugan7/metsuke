# Deploying

Three pieces, three homes. They are separate on purpose: the only one that needs a disk
is the one that keeps data, and the only one that needs a CDN is the one everybody hits.

| Piece | Where | Why there |
|---|---|---|
| The website | Vercel | Three static files, no build. Free, instant, and a domain is one click. |
| The installers | GitHub Releases | Free and unmetered for public repos, on a CDN, and already wired three ways. |
| Telemetry + dashboard | A small VM with a disk | SQLite is a file. Serverless hosts have no persistent one. |

## The installers go on GitHub Releases

This is not a preference, it is what the code already does:

- `site/download.js` reads `api.github.com/repos/OWNER/REPO/releases/latest` and picks the
  right asset per platform and architecture.
- `electron-builder.yml` has `publish: provider: github`.
- `electron-updater` in the app reads `latest-mac.yml`, `latest.yml` and
  `latest-linux.yml` from the release, which is why the workflow uploads them.

**This requires the repository to be public.** Release assets on a private repo need an
authenticated request, so public download links would 404 for everybody. If the code must
stay private, the installers have to move to object storage (R2, S3, Backblaze) and three
things change: `download.js`, the publish provider, and the update feed URL. Say so before
the first release rather than after.

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
2. Leave every setting alone. `vercel.json` overrides the framework preset.
3. Deploy. Add a domain if you have one.

Pushes to the default branch redeploy. Pull requests get preview URLs.

## Telemetry, if you want it

Not Vercel: functions are stateless and have no persistent disk, so a SQLite file would
vanish between invocations. It wants the cheapest VM with a volume — Fly.io, Railway, or a
$5 VPS behind Caddy.

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
