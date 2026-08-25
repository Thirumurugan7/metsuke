# Why site/vercel.json looks like this

Vercel validates `vercel.json` against a strict schema and rejects any key it does not
know, including the `//` pseudo-comments this reasoning used to live in. The deploy fails
with *Invalid request: should NOT have additional property `//`*. JSON has no comments, so
the explanations live here instead.

**`root`**

Root Directory is set to site/ in the Vercel dashboard, so this file has to live here: Vercel reads vercel.json from the root directory it was told to use. There is no package.json beside it, which is what stops Vercel from finding the Electron app one level up and trying to build it.

**`rewrites[0]`**

Browsers ask for /favicon.ico whatever the icon link says, and a 404 in the console of a landing page is a bad first impression. Serving the existing SVG saves committing a binary nobody can diff.

**`headers[0].headers[0]`**

The page has no inline script or style at all, so this can be strict. api.github.com is in connect-src because download.js asks it for the latest release; without that, every download button silently falls back to the releases page.

**`headers[1]`**

Assets are not content-hashed, so they cannot be cached forever. An hour at the edge with revalidation keeps a screenshot swap from taking a day to appear.

**`headers[2]`**

HTML is always revalidated: the roadmap is the whole point of the site being current.
