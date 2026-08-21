# Metsuke telemetry

Ingest and dashboard for the editor's usage reporting, plus the roadmap's shared ticks.

Storage is Neon Postgres. It was SQLite, which was right for one box with a disk; this
runs as Vercel functions, and a function has no disk. Nothing about the data wanted a
bigger database — it is a hosting decision, not a scale one.

Two front ends share every rule through `src/handlers.ts`: the functions in `api/`, and a
long-running server in `src/server.ts` for anyone who would rather own the box. Keeping the
behaviour out of both means the ingest boundary is tested once, rather than the tested path
being the one nobody deploys.

Nothing here runs unless you deploy it. The app compiles in an endpoint at build time and
defaults to empty, so a build made without `METSUKE_TELEMETRY_ENDPOINT` collects nothing
regardless of what any user consents to.

## Running it

```bash
npm install
npm run build
DATABASE_URL=... DASHBOARD_TOKEN=$(openssl rand -hex 32) npm start
```

It refuses to start without `DASHBOARD_TOKEN`, because the alternative is a dashboard of
your users' data open to the internet.

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | *(required)* | Neon Postgres. Use the `-pooler` host |
| `DASHBOARD_TOKEN` | *(required)* | Password for the dashboard and the read API |
| `SITE_ORIGIN` | `*` | Which origin may read and write roadmap ticks |
| `PORT` | `8787` | Standalone server only |
| `RETENTION_DAYS` | `180` | Events older than this are deleted daily |
| `RATE_LIMIT_PER_MINUTE` | `60` | Per address. Raise it if a proxy hides the real one |

Put it behind a TLS terminator (Caddy, nginx, a platform that does it for you) and point
`METSUKE_TELEMETRY_ENDPOINT` at `https://your-host/v1/events` when building the app.

```
POST /v1/events   ingest, unauthenticated, rate limited
GET  /health      liveness
GET  /            dashboard, behind DASHBOARD_TOKEN
GET  /api/overview?days=30   the dashboard's data, same auth
```

Log in with any username and the token as the password.

## What it stores, and what it refuses to

Every event is validated against `src/shared/telemetry.ts` — the app's own schema,
imported rather than copied, so the two cannot drift. An event that is not in that closed
list is dropped, which is the point of validating on the server as well as the client: a
client can be edited, and the schema is where the agreement is actually enforced.

There is no IP column. Addresses are hashed to rate limit, held for a minute, and never
written down. In the serverless deployment that counter is per warm instance rather than
global, which makes it a speed bump rather than a wall; the size caps on bodies and batches
are the real defence. There is no raw-envelope blob either, because keeping the original "just in
case" is how data nobody agreed to ends up on disk anyway.

Retention deletes events past the window on a daily timer. Install rows survive it: they
are a random id and two timestamps, and dropping them would make "how many people" wrong
forever.

## Tests

```bash
DATABASE_URL=... npm test
```

They run against real Postgres, each file in a schema it creates and drops, because a mock
would agree with whatever the queries do — and the dialect is the part most likely to be
wrong. They cover the ingest boundary with the payloads that matter — an event nobody agreed to,
a mixed batch, an unknown schema version, an oversized body — and the aggregation, including
that the daily chart buckets by when something happened rather than when it arrived, and
falls back to arrival when a client's clock is impossible.
