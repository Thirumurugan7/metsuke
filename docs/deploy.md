# Deploying

Three pieces, three homes. They are separate on purpose: the only one that needs a disk
is the one that keeps data, and the only one that needs a CDN is the one everybody hits.

| Piece | Where | Why there |
|---|---|---|
| The website | Vercel | Three static files, no build. Free, instant, and a domain is one click. |
| The installers | GitHub Releases, in a *separate public repo* | Free, unmetered, on a CDN, and the update client speaks it natively. |
| Telemetry + dashboard | Vercel, second project | Functions plus Neon Postgres, so there is no VM and no disk to keep. |
| The database | Neon | One Postgres, shared by telemetry and the roadmap's ticks. |

## The installers stay in the private repo

Releases are attached to a release on `Thirumurugan7/metsuke`, which is private and stays
private. Its assets need an authenticated request, which somebody clicking a download
button does not have — so nobody links to them directly.

`server/api/download.ts` makes the request instead, with a read-only token that never
leaves the server, and hands back the signed URL GitHub replies with. The bytes never pass
through it: asking GitHub for an asset with `Accept: application/octet-stream` returns a
302 to a signed object URL, and the function forwards that redirect, so a hundred megabytes
travels browser-to-GitHub rather than through a function with a timeout and a bandwidth
bill.

The same endpoint is the update feed. electron-updater uses its `generic` provider pointed
at `/download`, because the `github` provider would need a token inside the shipped app —
which is making the repo public with extra steps.

| What | Where |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT, **read-only on Contents** for this one repo, set on the telemetry project |
| `RELEASES_REPO` | `Thirumurugan7/metsuke`, the default |
| `METSUKE_UPDATE_URL` | Repository secret: `https://<telemetry-project>.vercel.app/download` |
| `window.METSUKE_DOWNLOAD_API` | `site/config.js`, same `/download` URL |

Until those exist the download buttons say "No release published yet", which is true and
costs nobody a 404.

Object storage (R2, S3) is the alternative, and it means a second account, a second place
for things to be out of date, and rewriting the update client. This needs one token.

## The website on Vercel

`vercel.json` at the repo root does the whole configuration, so there is nothing to set in
the dashboard beyond connecting the repo.

It exists mostly to stop Vercel being helpful. The repo root is an Electron app: left to
its own detection, Vercel would run `npm install` (downloading Electron and rebuilding
node-pty), then `npm run build` (building the desktop app), and deploy none of it. Both
commands are stubbed out and `outputDirectory` points at `site`.

### What is in site/vercel.json, since it cannot say so itself

Vercel validates the file with `additionalProperties: false`, so the usual `"//"` comment
key is rejected outright — the deploy fails with *should NOT have additional property*.
The reasoning therefore lives here instead.

- **`headers` → Content-Security-Policy.** Strict, because the site can afford it: no
  inline script or style anywhere. `connect-src` allows `api.github.com`, and that one
  entry is load-bearing — without it the release lookup is blocked and every download
  button silently falls back to the releases page.
- **The other five headers** are the ordinary hardening: nosniff, a referrer policy,
  `DENY` framing, a permissions policy, and HSTS.
- **`Cache-Control` in two blocks.** Assets are not content-hashed, so they cannot be
  cached forever; an hour at the edge with revalidation means swapping the screenshot
  shows up the same day. HTML always revalidates, because the roadmap being current is
  the point of it.
- **`rewrites` → `/favicon.ico`.** Browsers request it whatever the icon link says, and a
  404 in a landing page's console is a poor first impression. Pointing it at the existing
  SVG saves committing a binary nobody can diff.
- **`cleanUrls`.** `/roadmap` rather than `/roadmap.html`.

Checked against Vercel's published schema, every key at every level, before deploying —
which is how the comment keys were caught the second time rather than the first.

1. Vercel → Add New Project → import the repo.
2. **Set Root Directory to `site`.** That is the one setting that matters, and it is why
   `vercel.json` lives in `site/` rather than at the repo root: Vercel reads the config
   from whichever directory it was pointed at.
3. Leave everything else alone. There is no `package.json` in `site/`, so nothing tries to
   build the Electron app sitting one level up.
4. Deploy. Add a domain if you have one.

Pushes to the default branch redeploy. Pull requests get preview URLs.

## Telemetry and the dashboard

A **second Vercel project** from the same repository, with **Root Directory `server`**.
Storage is Neon rather than SQLite: functions have no disk, so a file-backed database was
never going to survive there. Nothing about the data wanted a bigger database — this was a
hosting decision, not a scale one.

Two projects rather than one because the site should stay a pile of static files with no
runtime, and because it keeps the ingest endpoint on a different origin from the marketing
page.

1. Vercel → Add New Project → same repository → **Root Directory `server`**.
2. Environment variables:
   - `DATABASE_URL` — the Neon connection string. Use the **`-pooler`** host: it is
     PgBouncer, and it is what makes a function opening a connection per invocation
     survivable.
   - `DASHBOARD_TOKEN` — anything long and random. Without it the dashboard refuses to
     serve.
   - `SITE_ORIGIN` — your site's URL, so the ticks endpoint accepts calls from it and not
     from every page on the internet.
3. Deploy. The tables create themselves on first request; `npm run migrate` does it ahead
   of time if you would rather.

Then two settings connect everything up:

- `METSUKE_TELEMETRY_ENDPOINT` as a **repository secret**, pointing at
  `https://<telemetry-project>.vercel.app/v1/events`, so release builds compile it in.
  Until it exists the app collects nothing, whatever anyone consents to.
- `window.METSUKE_ROADMAP_API` in `site/config.js`, pointing at that project's `/api/ticks`,
  which is what makes the roadmap's ticks follow you between machines. Leave it empty and
  the checklist keeps them in one browser, exactly as it always did.

The site's CSP currently allows `https://*.vercel.app` in `connect-src` so this works on
the default domain. Tighten it to the exact host once you have one.

### The dashboard

`https://<telemetry-project>.vercel.app/` — any username, `DASHBOARD_TOKEN` as the
password.

### Or a VM instead

`server/src/server.ts` is the same behaviour as a long-running process, sharing every
rule with the functions through `handlers.ts`. `npm start` with the same environment
variables. Worth it only if you would rather not run functions at all.

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
