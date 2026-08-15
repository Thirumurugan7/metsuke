# Driving the editor over CDP

In dev the app exposes its own window on port 9222 (`METSUKE_DEBUG_PORT` overrides).
These three scripts talk to it. Node 22+ only, no dependencies.

```bash
node tools/cdp/eval.mjs "document.title"                 # run JS in the renderer
TARGET=alert.html node tools/cdp/eval.mjs "…"            # target another window
node tools/cdp/shot.mjs out.png                          # screenshot
node tools/cdp/drag.mjs 349 467 499 467 15               # a real mouse drag
```

`__store` is exposed on `window` in dev, so state is readable directly:

```bash
node tools/cdp/eval.mjs "__store.getState().sidebarWidth"
```

The preview webview is a separate target, selected with `TARGET=<url fragment>`.

## Things that will waste your time

**Do not attach a second CDP client to the preview webview.** `AutomationService` already
holds its debugger, and a second connection detaches it. Drive the preview through the
control bridge instead, which goes via Electron's own attachment:

```bash
# "Metsuke (dev)" is not a typo: a run from the repo keeps its own userData directory,
# so launching the packaged app cannot overwrite the bridge port and token underneath it.
CFG="$HOME/Library/Application Support/Metsuke (dev)/mcp-preview.json"
URL=$(python3 -c "import json;print(json.load(open('$CFG'))['mcpServers']['preview']['env']['METSUKE_CONTROL_URL'])")
TOK=$(python3 -c "import json;print(json.load(open('$CFG'))['mcpServers']['preview']['env']['METSUKE_CONTROL_TOKEN'])")
curl -s -X POST "$URL/call" -H "authorization: Bearer $TOK" \
  -H 'content-type: application/json' --data '{"tool":"preview_state","args":{}}'
```

**Screenshots hang when the window is occluded.** The compositor stops producing frames,
so `Page.captureScreenshot` never resolves. Read computed styles and geometry instead.
This is a real limitation of `preview_screenshot` too, not just of testing.

**Presence is not visibility.** `querySelector(el).click()` succeeds on an element that is
clipped, covered, or off-screen. Two shipped bugs came from checking the DOM instead of
the pixels. Check that `document.elementFromPoint` at the element's centre resolves back
to it:

```js
const r = el.getBoundingClientRect()
let hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
const reallyVisible = hit === el || el.contains(hit)
```

**Measure coordinates in the same call you use them.** Layout shifts between CDP
connections, and a drag aimed at a stale position silently hits whatever is behind.

**Do not import app modules dynamically in a probe.** Vite appends HMR timestamps to
module URLs, so `import('/src/…')` hands back a *second* instance with its own empty
state. Drive the UI instead.
