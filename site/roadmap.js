/*
 * The build checklist.
 *
 * TASKS below is the source of truth and lives in git, so the list itself is reviewable
 * in a diff. Ticking a box writes to localStorage, which means your ticks survive a
 * reload and stay on your machine. When something is genuinely finished, flip `done` in
 * this file and commit it, so the repo and the page agree.
 *
 * `who` is who is blocked on it: 'you' needs an account, money, or a machine I do not
 * have. 'me' is work I can pick up without anything from you.
 */

const TASKS = [
  {
    id: 'blocking',
    title: 'Blocking',
    blurb: 'A user cannot install and run this until every one of these is done.',
    items: [
      {
        id: 'rename',
        who: 'me',
        done: true,
        text: 'Rename off "Open Claude"',
        detail:
          'Done. The product is Metsuke, a kendo term for where you fix your gaze during a fight, and under the shogunate the officer who watched on the shogun\'s behalf. The old name put Anthropic\'s trademark in the product name and read as official. The change ran through 34 files: package.json, the electron-builder appId and installer names, the userData directory, TERM_PROGRAM, the MCP server identity, the METSUKE_ env prefix, every localStorage key, the worktree directory, all UI strings, the tests and the site. It landed before anyone had saved settings, which is the only moment it could be done without orphaning them.'
      },
      {
        id: 'license',
        who: 'me',
        done: true,
        text: 'Add a LICENSE file',
        detail:
          'Done. MIT, copyright Thirumurugan Sivalingam, matching the claim package.json was already making. Until it existed the code was legally unusable by anyone who found it.'
      },
      {
        id: 'claude-missing',
        who: 'me',
        done: true,
        text: 'Handle a missing claude binary',
        detail:
          'Done. The welcome screen probes for it and says plainly if it is absent, noting that everything else still works. The probe runs through a login shell, because a GUI app does not inherit the PATH that nvm or homebrew set up and would otherwise report it missing on machines where the terminal runs it fine.'
      },
      {
        id: 'github-repo',
        who: 'you',
        text: 'Create the GitHub repo and push',
        detail:
          'The repo is local only, 13 commits on master, no remote. Everything below depends on this existing. Needs your GitHub auth, and publishing your code is your call.'
      },
      {
        id: 'site-placeholders',
        who: 'me',
        done: true,
        text: 'Set the repo placeholders on the site',
        detail:
          'Done. Eleven placeholders across the site now point at Thirumurugan7/metsuke, and package.json gained repository, homepage and bugs. That last part mattered more than the links: with no repository to resolve, electron-builder threw at the publish step and exited non-zero after producing perfectly good artifacts, and it never wrote latest-mac.yml, which is the file electron-updater actually reads. Verified with a full two-architecture build that exits clean and writes a feed listing all four artifacts with their sizes and hashes. The repo does not exist yet, so the links 404 until you create it, and nothing here has to change when you do.'
      },
      {
        id: 'deploy-site',
        who: 'you',
        text: 'Connect the repo to Vercel',
        detail:
          'vercel.json at the repo root does the whole configuration, so there is nothing to set in the dashboard beyond importing the repo. It exists mostly to stop Vercel being helpful: the root is an Electron app, and the default detection would npm install Electron, run the desktop build and deploy none of it. It also sets a strict CSP, verified by serving the site under those exact headers and loading it: no violations, styles applied, and the GitHub release lookup still allowed through, which is the one entry that matters. See docs/deploy.md.'
      },
      {
        id: 'run-ci',
        who: 'you',
        text: 'Run the release workflow once',
        detail:
          '.github/workflows/release.yml has never executed. Tag with npm version and push with --follow-tags. Until it runs, zero installers exist for any platform.'
      },
      {
        id: 'test-windows',
        who: 'you',
        text: 'Launch and use the Windows build',
        detail:
          'Never compiled, never run. I fixed three Windows-specific bugs by reading the code rather than executing it: the hook shell syntax, the /dev/null git diff, and the ps process table. There will be more.'
      },
      {
        id: 'test-linux',
        who: 'you',
        text: 'Launch and use the Linux build',
        detail:
          'Never compiled, never run. Same caveat as Windows. AppImage and .deb are configured but unproven.'
      },
      {
        id: 'deploy-telemetry',
        who: 'you',
        text: 'Deploy the telemetry server and set the endpoint',
        detail:
          'server/ is a Node process and a SQLite file, with a dashboard behind a token. It needs somewhere to run with TLS in front of it, then two settings: DASHBOARD_TOKEN on the server, and METSUKE_TELEMETRY_ENDPOINT as a repository secret so release builds compile it in. Until both exist the app collects nothing, whatever anyone consents to, which is the correct default for a build nobody has deployed a server for.'
      },
      {
        id: 'outstanding-bugs',
        who: 'both',
        text: 'Triage the issues you parked',
        detail:
          'You said there were many and that we would come back to them. I never got the list, so none of them are in this checklist yet. Send them over and they become items here.'
      }
    ]
  },

  {
    id: 'public',
    title: 'Before it goes public',
    blurb: 'Installable without these, but most people will bounce off.',
    items: [
      {
        id: 'sign-mac',
        who: 'you',
        text: 'Sign and notarise the macOS build',
        detail:
          'Needs an Apple Developer ID, 99 USD a year. Without it Gatekeeper blocks the app outright on current macOS and your install instructions become "bypass your operating system\'s security warning".'
      },
      {
        id: 'sign-win',
        who: 'you',
        text: 'Sign the Windows build',
        detail:
          'Without a certificate SmartScreen warns on every download. Costs money and usually an identity check.'
      },
      {
        id: 'auto-update',
        who: 'me',
        done: true,
        text: 'Wire auto-update',
        detail:
          'Built, with one part nobody can test yet. electron-updater checks GitHub on launch and every six hours, downloads in the background, and then stops: installing quits the app, and quitting kills every terminal and every running claude session, so it waits to be asked. A ready update appears in the status bar and nowhere else, since a bar that permanently says "up to date" is one nobody reads. It is a checkbox in Settings because it is the only request the app makes on its own, and the README says so. A run from the repo reports itself as unable to update rather than checking forever. Verified as far as it can be: the preference round-trips to disk and back into the UI, and the settings panel says plainly why a dev build cannot update. The actual check, download and install cannot be exercised until a release exists to compare against, which needs the repo.'
      },
      {
        id: 'document-preview-security',
        who: 'me',
        done: true,
        text: 'Document what the preview actually does',
        detail:
          'Done. The README now has a section called "What the preview actually is, and what that means", which states the parts that are risks rather than only the parts that are defensible: Claude has real CDP over the loaded page and can run arbitrary JavaScript in it, everything on that page can reach the model, webSecurity is off so the page can make cross-origin requests a browser would block, the session persists so anything you log into inside the pane stays logged in and reachable, and the bridge token sits in userData where any process running as you can read it. The site links to it from the download notes.'
      },
      {
        id: 'disclaimer',
        who: 'me',
        done: true,
        text: 'Add a not-affiliated notice',
        detail:
          'Done. It says Metsuke is independent, not affiliated with or endorsed by Anthropic, that Claude and Claude Code are their trademarks, and that you bring your own account. It appears in the README, in the footer of both site pages, and on the welcome screen, which is the one screen every first-time user passes.'
      },
      {
        id: 'third-party-licenses',
        who: 'me',
        done: true,
        text: 'Attribute third-party licenses',
        detail: 'Done. THIRD-PARTY-LICENSES.md attributes 118 packages with every license text reproduced in full, generated by tools/licenses.mjs from the installed tree rather than written by hand. It covers what electron-builder copies into the app and what is compiled into the renderer, since React and Monaco being devDependencies is a statement about who installs them, not about whether they ship. npm run licenses:check fails when it is stale.'
      },
      {
        id: 'telemetry-position',
        who: 'me',
        done: true,
        text: 'State the telemetry position',
        detail:
          'Done, and then rewritten when the position changed. It said no analytics and no crash reporting, which was true and verified at the time. Usage reporting now exists, so the README, the download page, the welcome screen and the settings panel were all updated in the same commit that added it: off until asked, both answers one click, a closed list of events with no free-text field, and every string scrubbed of paths, emails and tokens before it is even queued. The claim and the code have to move together or the claim is worthless.'
      }
    ]
  },

  {
    id: 'gaps',
    title: 'Gaps in what I built',
    blurb:
      'Things I shipped that are unverified, incomplete, or that I worked around rather than fixed. Listed so they are not quietly forgotten.',
    items: [
      {
        id: 'verify-chrome-deny',
        who: 'me',
        done: true,
        text: 'Confirm Claude actually stops using the Chrome tools',
        detail:
          'Done, watched rather than reasoned about. A live session in the editor was asked to open a page in "the browser you have". The 23 deny patterns were on its argv, and it went straight for preview_navigate without ever mentioning the Chrome extension: no refusal was needed, because the appended system prompt had already pointed it at the right tool. Two honest notes from watching it. With the preview pane closed it got "Preview is not open", correctly explained, and then said it could not open the pane itself and needed the user to. And it answered anyway by falling back to curl, while saying plainly that curl sees the served HTML rather than what a browser renders. --strict-mcp-config was never needed.'
      },
      {
        id: 'packaged-dmg',
        who: 'me',
        done: true,
        text: 'Produce and open a real .dmg',
        detail:
          'Done, and it found a packaging bug that had never been hit because only dist:dir had ever run. electron-builder bundles its own older @electron/rebuild pinned to node-gyp 9, whose vendored gyp imports distutils, removed in Python 3.12; the build made the first architecture and then died rebuilding node-pty for the second. Overriding node-gyp alone fixed the crash and then hung the old worker at zero CPU indefinitely. The fix is an npm override pointing every copy at the direct dependency. The arm64 .dmg mounts, carries the Applications symlink and a correct bundle (dev.metsuke.app, arm64, node-pty unpacked outside the asar), and the app launches from it and opens a real 1470x923 window. It also proved the userData split with the real thing: the packaged app wrote its own directory and left the running dev config byte-identical.'
      },
      {
        id: 'userdata-clash',
        who: 'me',
        done: true,
        text: 'Stop dev and packaged builds clobbering each other',
        detail:
          'Done. A run from the repo now keeps its own userData directory, "Metsuke (dev)", so an installed build cannot rewrite the bridge port and token under a running dev session. It keys off isPackaged rather than the dev server, because electron-vite preview runs the built output and is still a run from the repo, and it leaves an explicit --user-data-dir alone so the UI suite keeps its throwaway profile. The directory is created rather than left to whoever writes first: Chromium writes DevToolsActivePort into it during startup and logged an error on every launch until it existed.'
      },
      {
        id: 'main-restart-sessions',
        who: 'me',
        done: true,
        text: 'Survive main-process restarts, not just renderer reloads',
        detail:
          'Done. Ptys now run in their own detached process and main attaches to it over a unix socket, because a pty master is a file descriptor that cannot be handed over or reopened: anything main owns dies with main. Verified by killing main outright and restarting: the host survived reparented to init, both ptys kept running, and the claude session came back with the same session id, the same pty pid and 1875 characters of scrollback replayed. Sessions are still killed on a real quit, and only there. If the host cannot start, terminals fall back to running in-process exactly as before, because a terminal that does not survive a restart is a disappointment and a terminal that does not open is a broken editor.'
      },
      {
        id: 'e2e-tests',
        who: 'me',
        done: true,
        text: 'Add end-to-end tests',
        detail:
          'Done. 143 unit tests cover git, worktrees, threads, the path jail, the IPC contract, hook classification and fuzzy matching, and a 26 test Playwright suite drives the real built app and compares masked screenshots against 25 committed baselines across the shell, git, terminals, threads, preview and all seven themes. Two flows are deliberately not covered: the floating alert window, a separate BrowserWindow that only appears on a real notification, and the preview element picker, which drives CDP over the webview and would conflict with the harness attaching its own debugger. It runs locally only and cannot run in CI, since it needs a real claude binary on PATH. Running it briefly takes focus, because launching Electron activates the app on macOS and no test-side setting prevents that, so it is worth running when you are not mid-task.'
      },
      {
        id: 'review-baselines',
        who: 'you',
        text: 'Confirm the one re-blessed screenshot',
        detail:
          'The baselines were regenerated after the rename and all 26 tests passed. Only one image actually moved, smoke.spec.ts/welcome.png, since the other shots do not include the title bar. Compared against the committed version it differs in three ways and no others: the title bar and the heading say Metsuke, and the new non-affiliation paragraph pushes the vertically centred block up by about 20px. That is my reading of it; a blessed baseline is a test that agrees with whatever the app did, so it is worth 30 seconds of yours.'
      },
      {
        id: 'threads-subagent-cards',
        who: 'me',
        done: true,
        text: 'Show a subagent report in the conversation',
        detail:
          'Done. The report is kept now instead of being reduced to a token count, and the sidebar row expands to show it, one at a time so the list stays navigable. The text is pulled out of a bare string, out of API-style content blocks, or failing both out of the raw JSON, because the shape varies by CLI version and a report nobody can reach is the one thing threads cannot afford to drop. Capped at 20k characters, since it is held in memory, sent over IPC on every thread change, and written to the state file.'
      },
      {
        id: 'threads-persistence',
        who: 'me',
        done: true,
        text: 'Remember threads across a restart',
        detail:
          'Done. Instances with their own worktree are written to a state file and restored on launch, finished rather than pretending to be alive: the pty died with the process, but the branch and the checkout are still there, so a restored thread can be landed or closed. One whose worktree has since been deleted is dropped. Threads that shared the workspace and subagents are not persisted, because nothing is left behind them to restore.'
      },
      {
        id: 'preview-open-itself',
        who: 'me',
        done: true,
        text: 'Let Claude open the preview pane it is told to use',
        detail:
          'Done. preview_navigate now opens the pane instead of refusing: it asks the UI to show it, waits up to five seconds for the webview to mount and the debugger to attach, and then proceeds. Navigating is the entry point, so it is the one tool that opens things; the rest still answer "not open", which is correct when there is no page to act on. If the pane never comes up the call fails with the same explained error as before. Verified from the unattached state that used to fail: the call returned openedPreview, the pane went from detached to attached with the page loaded, and a follow-up preview_state read the real title and headings back.'
      },
      {
        id: 'preview-scroll-hang',
        who: 'me',
        done: true,
        text: 'Fix preview_scroll intermittently hanging the bridge',
        detail:
          'Done, with one honest caveat. Chromium had no deadline on a debugger command, so a call it never acknowledged left the bridge request pending forever, which is why the symptom was an empty body after the caller gave up rather than an error. Every CDP call now has a 15 second deadline and fails naming the method that stuck. The likely cause of the stall itself was the same frame starvation that hung screenshots, and it is addressed by the same switches; 20 consecutive scrolls through the bridge with the window in the background came back in about 30ms each. The stall was intermittent to begin with, so that is evidence rather than proof, and if it does come back it now says so instead of going quiet.'
      },
      {
        id: 'video-pixel-format',
        who: 'me',
        done: true,
        text: 'Work out what logs "Unsupported pixel format"',
        detail:
          'Closed, but not the way it was written: re-encoding cannot silence it, because the message was never about our clip. It comes from Chromium\'s own ffmpeg_common.cc when a stream config is built before a pixel format is known. Tested three ways, h264 with audio, h264 without, and VP9 in webm, and it appeared identically in all three; it also appeared three times in a session where the flourish never played and only the preview loaded a page. Nothing in this codebase can remove it, and the levers that would, like dropping the Chromium log level, would take real errors with it. The clip is now VP9 with the dead audio track gone, 271KB against 751KB, which was worth doing on its own.'
      },
      {
        id: 'preview-screenshot-occluded',
        who: 'me',
        done: true,
        text: 'Fix screenshots of a backgrounded window',
        detail:
          'Done. The app launches with backgrounding of occluded windows, renderer backgrounding and background timer throttling all disabled, which are the three switches the UI suite already needed to capture an off-screen window, now applied to every build. Verified by reproducing it and then not: the same capture that timed out against an unfocused window returned in 0.57s afterwards, and three preview_screenshot calls through the bridge came back in about 0.1s each with the editor behind another window. The cost is that a hidden window keeps rendering, which is the point of it.'
      }
    ]
  },

  {
    id: 'polish',
    title: 'Polish',
    blurb: 'What decides whether someone keeps it after the first hour.',
    items: [
      {
        id: 'clean-machine',
        who: 'you',
        text: 'First run on a clean machine',
        detail:
          'No dev toolchain, no folder open, no git repo, no network. Everything so far has been tested on the one machine that has all of it installed.'
      },
      {
        id: 'crash-handling',
        who: 'me',
        done: true,
        text: 'Handle a main-process crash',
        detail:
          'Done, and the response now differs by what died. A renderer crash rebuilds the window, which is invisible recovery: verified by killing the renderer over CDP and watching the workspace come back with its terminal reattached rather than duplicated. A second crash within ten seconds stops instead of looping, since reloading into a renderer that crashes on load is a flickering window and a pinned core. An uncaught exception in main is fatal by definition and offers a restart, naming the actual error rather than apologising. An unhandled rejection is recorded but not fatal, because killing an editor mid-session over one rejected promise is worse than the bug. Everything lands in crashes.log in userData, oldest entries dropped first so the newest crash always survives. The fatal dialog itself was read rather than fired, since triggering it means a modal on someone\'s screen and an app that exits.'
      },
      {
        id: 'onboarding',
        who: 'me',
        done: true,
        text: 'First-run guidance',
        detail:
          'Done. A welcome screen that says what the editor is and gives three steps, plus a guide behind ? Guide written as flows. It also probes for the claude binary through a login shell, so it does not falsely report it missing on a GUI launch.'
      },
      {
        id: 'real-screenshot',
        who: 'me',
        done: true,
        text: 'Put a real screenshot on the site',
        detail:
          'Done. The hand-built HTML mock is gone and the hero is a capture of the running app with this repository open in it: the file tree, AutomationService.ts in the editor, a live claude session in the terminal, and the preview pane showing this checklist. webp at 189KB with a png fallback, and about 130 lines of markup and CSS for the mock deleted with it. Verified by loading the page in the app\'s own preview pane and looking at it.'
      },
      {
        id: 'a11y',
        who: 'me',
        done: true,
        text: 'Accessibility pass',
        detail:
          'Done for the keyboard, which is where the real gaps were. Every overlay now traps Tab and hands focus back to whatever opened it: before this, Tab off the last control in a dialog moved focus to the window behind, so a keyboard user ended up typing into a file tree they could not see past the modal. The file tree is now one tab stop rather than one per file, with arrow keys to move, right and left to open and close a directory, and Home and End, which is the tree pattern and also what stops a large repo from putting hundreds of stops between you and the editor. aria-modal was missing on four dialogs and is there now. A screen reader run is still not done; that needs somebody who uses one.'
      }
    ]
  }
]

// ── rendering ────────────────────────────────────────────────────────────────

const STORE_KEY = 'metsuke.roadmap'

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveState(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state))
}

/** A tick in the browser beats the committed value, so your view is always yours. */
function isDone(item, state) {
  return state[item.id] ?? Boolean(item.done)
}

const WHO_LABEL = { you: 'needs you', me: 'I can do this', both: 'needs both' }

function render() {
  const state = loadState()
  const filter = document.querySelector('.filter .on')?.dataset.filter ?? 'all'
  const root = document.getElementById('groups')
  root.innerHTML = ''

  let total = 0
  let done = 0

  for (const group of TASKS) {
    const visible = group.items.filter((item) => {
      const complete = isDone(item, state)
      return filter === 'all' || (filter === 'todo' ? !complete : complete)
    })

    total += group.items.length
    done += group.items.filter((item) => isDone(item, state)).length

    if (visible.length === 0) continue

    const groupDone = group.items.filter((item) => isDone(item, state)).length
    const section = document.createElement('section')
    section.className = 'group'
    section.innerHTML = `
      <div class="group-head">
        <h2>${group.title}</h2>
        <span class="group-count">${groupDone} of ${group.items.length}</span>
      </div>
      <p class="group-blurb">${group.blurb}</p>
      <ul class="items"></ul>`

    const list = section.querySelector('.items')
    for (const item of visible) {
      const complete = isDone(item, state)
      const li = document.createElement('li')
      li.className = `item${complete ? ' done' : ''}`
      li.innerHTML = `
        <button class="tick" role="checkbox" aria-checked="${complete}" aria-label="${item.text}">
          <span aria-hidden="true">${complete ? '✓' : ''}</span>
        </button>
        <div class="item-body">
          <div class="item-top">
            <span class="item-text">${item.text}</span>
            <span class="who who-${item.who}">${WHO_LABEL[item.who]}</span>
          </div>
          <p class="item-detail">${item.detail}</p>
        </div>`

      li.querySelector('.tick').addEventListener('click', () => {
        const next = loadState()
        next[item.id] = !isDone(item, next)
        saveState(next)
        render()
      })

      list.appendChild(li)
    }

    root.appendChild(section)
  }

  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  document.getElementById('bar').style.width = `${percent}%`
  document.getElementById('count').textContent = `${done} of ${total} done`
  document.getElementById('percent').textContent = `${percent}%`

  const empty = document.getElementById('empty')
  empty.hidden = root.children.length > 0
}

for (const button of document.querySelectorAll('.filter button')) {
  button.addEventListener('click', () => {
    document.querySelector('.filter .on')?.classList.remove('on')
    button.classList.add('on')
    render()
  })
}

document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Clear every tick you have made in this browser?')) return
  localStorage.removeItem(STORE_KEY)
  render()
})

render()
