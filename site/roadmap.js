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
        text: 'Set the repo placeholders on the site',
        detail:
          'REPO in site/download.js, and five OWNER/REPO links in site/index.html. Until then every download button falls back to a releases page that does not exist.'
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
        text: 'Wire auto-update',
        detail:
          'Not present at all. Every user stays on whatever version they first downloaded, forever. electron-updater plus the GitHub publish config already in electron-builder.yml.'
      },
      {
        id: 'document-preview-security',
        who: 'me',
        text: 'Document what the preview actually does',
        detail:
          'It runs with webSecurity disabled and hands Claude unrestricted CDP control of the page. That is a defensible design and I would defend it, but people should read it in the README, not discover it.'
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
        text: 'Attribute third-party licenses',
        detail: 'Electron, Monaco, xterm.js and node-pty all require attribution.'
      },
      {
        id: 'telemetry-position',
        who: 'me',
        text: 'State the telemetry position',
        detail:
          'The app currently sends nothing anywhere. Saying so plainly in the README and on the site is worth more than staying quiet, and it is a claim that gets harder to make later.'
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
        who: 'both',
        text: 'Confirm Claude actually stops using the Chrome tools',
        detail:
          'I verified 23 deny patterns land on the spawned process argv. I never watched a live agent try the Chrome tool, get refused, and reach for preview_ instead. If it still misbehaves the next lever is --strict-mcp-config, which drops every other MCP server from editor sessions.'
      },
      {
        id: 'packaged-dmg',
        who: 'me',
        text: 'Produce and open a real .dmg',
        detail:
          'I only ever ran dist:dir, which makes an unpacked app. The .dmg path, its layout, and whether it mounts and installs cleanly are all untested.'
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
        text: 'Survive main-process restarts, not just renderer reloads',
        detail:
          'Sessions now reattach across a window reload, which fixed the complaint about constant restarts. A change to anything under src/main still kills every terminal, because the process that owns the ptys is the one restarting.'
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
        text: 'Re-encode the wheel clip to silence the decoder',
        detail:
          'Every playback logs "Unsupported pixel format: -1". Harmless, the video decodes fine at 560x560, but it fills the dev log and makes real errors harder to spot.'
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
        text: 'Handle a main-process crash',
        detail:
          'A renderer crash reloads and reattaches. A main crash takes everything with it and reports nothing.'
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
        text: 'Put a real screenshot on the site',
        detail: 'The hero is an HTML mock. Honest, but a photograph of the running app is better.'
      },
      {
        id: 'a11y',
        who: 'me',
        text: 'Accessibility pass',
        detail:
          'Every control has an accessible name, which I checked. Nothing has been through a screen reader or a keyboard-only run.'
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
