/*
 * The reusable pieces of the editor, as markup fragments.
 *
 * Each variant page composes these into a different arrangement. Keeping the content
 * identical across variants is the point: any difference you notice between two pages
 * is a difference of layout, not of what is on screen.
 */

const P = {
  titlebar: (extra = '') => `
    <div class="titlebar">
      <span class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
      <span class="app-name">Open Claude</span>
      <span class="title-meta">my-app · ⑂ main · 3 changes</span>
      <span class="title-right">${extra}</span>
    </div>`,

  rail: (active = 'files', horizontal = false) => {
    const items = [
      ['files', '▤', 'Files'],
      ['git', '⑂', 'Git'],
      ['search', '⌕', 'Search'],
      ['ports', '⚓', 'Ports'],
      ['claude', '✳', 'Claude']
    ]
    return `<div class="rail${horizontal ? ' horizontal' : ''}">${items
      .map(([id, icon, label]) => `<b class="${id === active ? 'on' : ''}"><i>${icon}</i>${label}</b>`)
      .join('')}</div>`
  },

  tree: () => `
    <div class="panel side">
      <div class="panel-head">Explorer</div>
      <div class="panel-body">
        <div class="tree">
          <div>▾ src</div>
          <div class="i1">▾ components</div>
          <div class="i2 sel">Signup.tsx <span class="m">M</span></div>
          <div class="i2">Button.tsx</div>
          <div class="i2">Nav.tsx</div>
          <div class="i1">App.tsx <span class="m">M</span></div>
          <div class="i1">api.ts <span class="u">U</span></div>
          <div>▾ tests</div>
          <div class="i1">signup.test.ts</div>
          <div>package.json</div>
          <div>README.md</div>
        </div>
      </div>
    </div>`,

  editor: (cls = '') => `
    <div class="panel editor ${cls}">
      <div class="tabs"><span class="on">Signup.tsx</span><span>api.ts</span><span>App.tsx</span></div>
      <div class="panel-body">
        <pre class="code"><span class="ln">10</span> <span class="c">// Signup.tsx</span>
<span class="ln">11</span> <span class="k">export function</span> <span class="f">Signup</span>() {
<span class="ln">12</span>   <span class="k">const</span> [email, setEmail] = <span class="f">useState</span>(<span class="s">''</span>)
<span class="ln">13</span>   <span class="k">const</span> [accepted, setAccepted] = <span class="f">useState</span>(<span class="n">false</span>)
<span class="ln">14</span>
<span class="ln">15</span>   <span class="k">return</span> (
<span class="ln">16</span>     &lt;<span class="t">form</span> onSubmit={submit}&gt;
<span class="ln">17</span>       &lt;<span class="t">input</span> value={email} required /&gt;
<span class="ln">18</span>       &lt;<span class="t">button</span> id=<span class="s">"submit"</span>&gt;Create account&lt;/<span class="t">button</span>&gt;
<span class="ln">19</span>     &lt;/<span class="t">form</span>&gt;
<span class="ln">20</span>   )
<span class="ln">21</span> }</pre>
      </div>
    </div>`,

  preview: (cls = '') => `
    <div class="panel preview ${cls}">
      <div class="urlbar"><span>‹ › ↻</span><span>localhost:3000</span><span class="live">● live</span></div>
      <div class="panel-body page">
        <h4>Create account</h4>
        <label>Email address</label>
        <div class="field">ada@example.com</div>
        <label>Password</label>
        <div class="field">••••••••</div>
        <div class="cta picked">Create account</div>
        <div class="picked-tag">button#submit selected</div>
      </div>
    </div>`,

  terminal: (cls = '') => `
    <div class="panel term ${cls}">
      <div class="termbar">
        <em class="on"><i class="c"></i>claude</em>
        <em><i class="s"></i>shell</em>
        <em><i class="c"></i>UI audit</em>
        <em style="margin-left:auto">＋ New</em>
      </div>
      <div class="panel-body">
        <div class="termlines">
<span class="p">›</span> make the signup button green and larger
<span class="d">⏺ Edited src/components/Signup.tsx</span>
<span class="d">⏺ preview_fill — filled 4 fields on /signup</span>
<span class="d">⏺ preview_state — <span class="bad">form rejected: "You must accept the terms"</span></span>
<span class="d">⏺ preview_console — 1 error on /checkout</span>
<span class="ok">⏺ Done. 2 files changed, 1 issue found.</span>
        </div>
      </div>
    </div>`,

  claude: () => `
    <div class="panel claude side">
      <div class="panel-head">Claude <span class="count">opus</span></div>
      <div class="panel-body">
        <div class="metric">
          <div class="big">561M</div>
          <div class="sub">tokens today</div>
          <div class="bar"><i class="in" style="width:4%"></i><i class="out" style="width:12%"></i><i class="ca" style="width:70%"></i></div>
        </div>
        <div class="metric">
          <div class="sub" style="margin-bottom:6px">Model</div>
          <div style="font-size:12.5px">Opus <span class="sub">· follows your default</span></div>
        </div>
        <div class="metric">
          <div class="sub" style="margin-bottom:6px">Skills <span class="count">16</span></div>
          <div style="font-size:12px">brainstorming</div>
          <div style="font-size:12px">executing-plans</div>
          <div style="font-size:12px">frontend-design</div>
        </div>
      </div>
    </div>`,

  status: (left = '📂 my-app · ⑂ main') => `
    <div class="status">
      <span>${left}</span>
      <span>3 changes</span>
      <span class="right">
        <span>? Guide</span><span>🔔 Alerts</span><span>⌕ Test UI</span><span>● Claude preview ready</span>
      </span>
    </div>`
}

/** Renders the notes drawer and wires its collapse plus any layout toggles. */
function notes({ kicker, title, body, good, bad, toggles = [] }) {
  const el = document.createElement('div')
  el.className = 'notes'
  el.innerHTML = `
    <button class="close" title="Collapse">−</button>
    <div class="kicker">${kicker}</div>
    <h2>${title}</h2>
    ${body.map((p) => `<p>${p}</p>`).join('')}
    ${good ? `<div class="good"><b>Works because</b>${good}</div>` : ''}
    ${bad ? `<div class="bad"><b>Costs you</b>${bad}</div>` : ''}
    <div class="toggles">
      <a class="chip ghost nav-back" href="index.html">← All variants</a>
      ${toggles.map((t, i) => `<button class="chip" data-toggle="${i}">${t.label}</button>`).join('')}
    </div>`
  document.body.appendChild(el)

  el.querySelector('.close').addEventListener('click', () => {
    el.classList.toggle('closed')
    el.querySelector('.close').textContent = el.classList.contains('closed') ? '+' : '−'
  })

  el.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const t = toggles[Number(button.dataset.toggle)]
      button.classList.toggle('on')
      t.apply(button.classList.contains('on'))
    })
  })
}
