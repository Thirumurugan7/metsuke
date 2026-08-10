# Open Claude — website

A static landing page: three files, no build step, no dependencies. Drop it on any
static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) or serve it locally:

```bash
cd site && python3 -m http.server 8090
```

## Before publishing

Replace the repository placeholder in two places:

- `site/download.js` — the `REPO` constant at the top
- `site/index.html` — five `OWNER/REPO` occurrences in links

Download links are resolved at page load from the GitHub Releases API, so the page
never needs editing when a version ships. If the API is unreachable, or no release
exists yet, every link falls back to the releases page.
