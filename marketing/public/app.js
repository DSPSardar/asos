/* ─────────────────────────────────────────────────────────────
   DSP Marketing Studio — single-page app
   Plain JS, hash routing, no build step. Views render into #view.
   ───────────────────────────────────────────────────────────── */
'use strict';

/* ══ State & storage ══════════════════════════════════════════ */

const store = {
  get secret() { return localStorage.getItem('dsp_secret') || ''; },
  set secret(v) { localStorage.setItem('dsp_secret', v); },
  get saved() { try { return JSON.parse(localStorage.getItem('dsp_saved') || '[]'); } catch { return []; } },
  set saved(v) { localStorage.setItem('dsp_saved', JSON.stringify(v)); },
  get chat() { try { return JSON.parse(sessionStorage.getItem('dsp_chat') || '[]'); } catch { return []; } },
  set chat(v) { sessionStorage.setItem('dsp_chat', JSON.stringify(v)); },
};

function saveOutput(type, title, content) {
  const items = store.saved;
  items.unshift({ id: Date.now(), type, title, content, at: new Date().toISOString() });
  store.saved = items.slice(0, 100); // cap
  toast('Saved to Saved Outputs', 'success');
}

/* ══ API client ═══════════════════════════════════════════════ */

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trigger-secret': store.secret },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.violations = data.violations;
    throw err;
  }
  return data;
}

/* ══ Tiny DOM helpers ═════════════════════════════════════════ */

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, kind = 'success') {
  const t = el(`<div class="toast toast-${kind}">${esc(msg)}</div>`);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
function errorBanner(message, onRetry) {
  const b = el(`<div class="banner banner-error"><span>⚠️ ${esc(message)}</span></div>`);
  if (onRetry) {
    const btn = el(`<button class="btn btn-ghost banner-retry">Retry</button>`);
    btn.onclick = onRetry;
    b.appendChild(btn);
  }
  return b;
}
function emptyState(icon, title, hint) {
  return el(`<div class="empty"><div class="empty-ico">${icon}</div><strong>${esc(title)}</strong><p>${esc(hint)}</p></div>`);
}
function copyBtn(getText) {
  const b = el(`<button class="btn btn-ghost">Copy</button>`);
  b.onclick = async () => { await navigator.clipboard.writeText(getText()); toast('Copied to clipboard'); };
  return b;
}
function spinnerBtn(label) {
  return el(`<button class="btn btn-primary" disabled><span class="spinner"></span> ${esc(label)}</button>`);
}

/* ══ Connection status (sidebar) ══════════════════════════════ */

async function checkConnection() {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (!store.secret) { dot.className = 'dot dot-gray'; label.textContent = 'Not connected — set secret in Settings'; return false; }
  try {
    // A deliberate bad-step call: 400 proves auth passed; 401 means bad secret.
    await api('/api/run', { step: '__ping__' });
  } catch (e) {
    if (e.status === 400) { dot.className = 'dot dot-green'; label.textContent = 'Connected'; return true; }
    dot.className = 'dot dot-red';
    label.textContent = e.status === 401 ? 'Wrong secret' : 'Server unreachable';
    return false;
  }
  return true;
}

/* ══ Views ════════════════════════════════════════════════════ */

const views = {};

/* ── Dashboard ── */
views.dashboard = (root) => {
  const saved = store.saved;
  root.append(el(`
    <div>
      <div class="grid grid-3">
        <div class="card stat"><span class="stat-num">${saved.length}</span><span class="stat-label">Saved outputs</span></div>
        <div class="card stat"><span class="stat-num">9 AM</span><span class="stat-label">Daily auto-post (PKT) — runs on the Mac</span></div>
        <div class="card stat"><span class="stat-num">Mon</span><span class="stat-label">New DSP batch cycle starts</span></div>
      </div>
      <div class="card">
        <h2>Quick actions</h2>
        <p class="sub">Jump straight into the most common jobs.</p>
        <div class="btn-row">
          <a href="#/social" class="btn btn-gold">✍️ Write today's post</a>
          <a href="#/campaign" class="btn btn-primary">🚀 Generate a campaign</a>
          <a href="#/chat" class="btn btn-ghost">💬 Ask the marketing agent</a>
        </div>
      </div>
      <div class="card" id="dash-recent">
        <h2>Recent outputs</h2>
        <p class="sub">Your latest saved work — full list in Saved Outputs.</p>
      </div>
    </div>
  `));
  const recent = root.querySelector('#dash-recent');
  if (!saved.length) {
    recent.appendChild(emptyState('📭', 'Nothing saved yet', 'Generate a post or campaign and hit Save — it will show up here.'));
  } else {
    saved.slice(0, 5).forEach((item) => {
      recent.appendChild(el(`
        <div class="saved-item">
          <div class="saved-meta">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.type)} · ${new Date(item.at).toLocaleString()}</span>
            <div class="saved-preview">${esc(item.content.slice(0, 160))}</div>
          </div>
        </div>
      `));
    });
  }
};

/* ── AI Marketing Chat ── */
views.chat = (root) => {
  root.append(el(`
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-msgs"></div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Ask about campaigns, positioning, content ideas… (Enter to send, Shift+Enter for newline)"></textarea>
        <button class="btn btn-primary" id="chat-send">Send</button>
      </div>
    </div>
  `));
  const msgsBox = root.querySelector('#chat-msgs');
  const input = root.querySelector('#chat-text');
  const sendBtn = root.querySelector('#chat-send');

  function render() {
    msgsBox.innerHTML = '';
    const history = store.chat;
    if (!history.length) {
      msgsBox.appendChild(emptyState('💬', 'Your DSP marketing consultant', 'Grounded in your knowledge files — it won\'t invent students or prices. Try: "Give me 3 content angles for diaspora professionals."'));
      return;
    }
    history.forEach((m) => msgsBox.appendChild(el(`<div class="msg msg-${m.role === 'user' ? 'user' : 'ai'}">${esc(m.content)}</div>`)));
    msgsBox.scrollTop = msgsBox.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    const history = store.chat;
    history.push({ role: 'user', content: text });
    store.chat = history;
    input.value = '';
    render();
    const thinking = el(`<div class="msg msg-ai"><span class="spinner spinner-dark"></span> thinking…</div>`);
    msgsBox.appendChild(thinking); msgsBox.scrollTop = msgsBox.scrollHeight;
    sendBtn.disabled = true;
    try {
      const { reply } = await api('/api/chat', { messages: store.chat });
      const h = store.chat; h.push({ role: 'assistant', content: reply }); store.chat = h;
      render();
    } catch (e) {
      thinking.remove();
      msgsBox.appendChild(errorBanner(e.message, send));
    } finally {
      sendBtn.disabled = false;
    }
  }
  sendBtn.onclick = send;
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  render();
};

/* ── Generator pages (social / adcopy / funnel share a factory) ── */
function generatorView({ mode, title, sub, placeholder, extraFields = '' }) {
  return (root) => {
    root.append(el(`
      <div>
        <div class="card">
          <h2>${esc(title)}</h2>
          <p class="sub">${esc(sub)}</p>
          <label class="field"><span>Brief</span>
            <textarea id="gen-brief" placeholder="${esc(placeholder)}"></textarea>
          </label>
          ${extraFields}
          <div class="btn-row"><button class="btn btn-gold" id="gen-go">Generate</button></div>
          <div id="gen-out"></div>
        </div>
      </div>
    `));
    const out = root.querySelector('#gen-out');
    const goBtn = root.querySelector('#gen-go');
    goBtn.onclick = async () => {
      const brief = root.querySelector('#gen-brief').value.trim();
      if (!brief) { toast('Write a brief first', 'error'); return; }
      const options = {};
      const platformSel = root.querySelector('#gen-platform');
      if (platformSel) options.platform = platformSel.value;
      out.innerHTML = '';
      const busy = spinnerBtn('Generating…');
      goBtn.replaceWith(busy);
      try {
        const { output } = await api('/api/generate', { mode, brief, options });
        const block = el(`<div class="output">${esc(output)}</div>`);
        const actions = el(`<div class="output-actions"></div>`);
        actions.appendChild(copyBtn(() => output));
        const saveB = el(`<button class="btn btn-ghost">Save</button>`);
        saveB.onclick = () => saveOutput(mode, brief.slice(0, 60), output);
        actions.appendChild(saveB);
        if (mode === 'social_post') {
          const pubB = el(`<button class="btn btn-gold">Publish to LinkedIn</button>`);
          pubB.onclick = () => publishFlow(output, actions);
          actions.appendChild(pubB);
        }
        block.appendChild(actions);
        out.appendChild(block);
      } catch (e) {
        out.appendChild(errorBanner(e.message, goBtn.onclick));
      } finally {
        busy.replaceWith(goBtn);
      }
    };
  };
}

// Publish with the server-side Verifier gate; shows violations if blocked.
async function publishFlow(text, mountAfter) {
  if (!confirm('Publish this to LinkedIn now? It will be publicly visible on the profile.')) return;
  const busy = spinnerBtn('Verifying & publishing…');
  mountAfter.appendChild(busy);
  try {
    const { postUrn } = await api('/api/publish', { text });
    toast('Published to LinkedIn ✓', 'success');
    mountAfter.appendChild(el(`<div class="banner banner-success">Live: <a href="https://www.linkedin.com/feed/update/${esc(postUrn)}/" target="_blank" rel="noopener">view post</a></div>`));
  } catch (e) {
    if (e.status === 422 && e.violations) {
      const list = e.violations.map((v) => `<li><strong>${esc(v.claim)}</strong> — ${esc(v.problem)}</li>`).join('');
      mountAfter.appendChild(el(`<div class="banner banner-error"><div>🚫 Blocked by the fact-check gate:<ul>${list}</ul>Edit the text or update knowledge files, then try again.</div></div>`));
    } else {
      mountAfter.appendChild(errorBanner(e.message));
    }
  } finally {
    busy.remove();
  }
}

views.social = generatorView({
  mode: 'social_post',
  title: 'Social Media Post Generator',
  sub: 'One post, grounded in DSP facts. LinkedIn posts can be published directly — behind the fact-check gate.',
  placeholder: 'e.g. LinkedIn post for diaspora professionals about the 9–10 PM PKT timing being workable from London/Toronto',
  extraFields: `
    <label class="field"><span>Platform</span>
      <select id="gen-platform">
        <option value="linkedin">LinkedIn</option>
        <option value="instagram">Instagram</option>
        <option value="tiktok">TikTok (caption + hook)</option>
        <option value="whatsapp">WhatsApp status</option>
      </select>
    </label>`,
});

views.adcopy = generatorView({
  mode: 'ad_copy',
  title: 'Ad Copy Generator',
  sub: '3 ad variants with different angles — headline, primary text, CTA. No prices, no fake urgency.',
  placeholder: 'e.g. Meta feed ads targeting Karachi professionals aged 25-40 curious about AI careers',
  extraFields: `
    <label class="field"><span>Placement</span>
      <select id="gen-platform">
        <option value="meta_feed">Meta feed</option>
        <option value="meta_reels">Meta Reels</option>
        <option value="tiktok_ads">TikTok ads</option>
        <option value="linkedin_ads">LinkedIn ads</option>
      </select>
    </label>`,
});

views.funnel = generatorView({
  mode: 'funnel',
  title: 'Funnel Planner',
  sub: 'Awareness → consideration → enrollment, with WhatsApp DM as the conversion channel and a metric per stage.',
  placeholder: 'e.g. funnel for converting Instagram Reel viewers into Monday-batch enrollments over one week',
});

/* ── Campaign Generator (runs the real 5-agent pipeline) ── */
views.campaign = (root) => {
  const STEPS = ['scout', 'planner', 'hook-writer', 'content-writer', 'repurposer'];
  root.append(el(`
    <div>
      <div class="card">
        <h2>Campaign Generator</h2>
        <p class="sub">Runs the full 5-agent DSP pipeline (Scout → Planner → Hook Writer → Content Writer → Repurposer). Takes 2–4 minutes; each step feeds the next.</p>
        <div class="btn-row"><button class="btn btn-gold" id="camp-go">Run full pipeline</button></div>
        <div class="step-list" id="camp-steps"></div>
        <div id="camp-out"></div>
      </div>
    </div>
  `));
  const stepsBox = root.querySelector('#camp-steps');
  const out = root.querySelector('#camp-out');
  const goBtn = root.querySelector('#camp-go');

  goBtn.onclick = async () => {
    goBtn.disabled = true;
    out.innerHTML = ''; stepsBox.innerHTML = '';
    const rows = {};
    STEPS.forEach((s) => { rows[s] = el(`<div class="step"><span class="step-state">○</span> ${s}</div>`); stepsBox.appendChild(rows[s]); });
    let prev = null;
    try {
      for (const step of STEPS) {
        rows[step].classList.add('running');
        rows[step].querySelector('.step-state').innerHTML = '<span class="spinner spinner-dark"></span>';
        const { output } = await api('/api/run', { step, previousOutput: prev });
        prev = output;
        rows[step].classList.remove('running'); rows[step].classList.add('done');
        rows[step].querySelector('.step-state').textContent = '✓';
      }
      // Final result: the repurposed multi-channel pack
      const li = prev.linkedin_post || '';
      const wa = prev.whatsapp_status_text || '';
      const block = el(`<div class="output"><h3>LinkedIn post</h3>${esc(li)}\n<h3>WhatsApp status</h3>${esc(wa)}<h3>Also generated</h3>Reel script (${(prev.reel_script || []).length} shots) · carousel (${(prev.carousel_slides || []).length} slides) · TikTok script (${(prev.tiktok_script || []).length} shots) · email</div>`);
      const actions = el(`<div class="output-actions"></div>`);
      actions.appendChild(copyBtn(() => JSON.stringify(prev, null, 2)));
      const saveB = el(`<button class="btn btn-ghost">Save campaign</button>`);
      saveB.onclick = () => saveOutput('campaign', `Pipeline run ${new Date().toLocaleDateString()}`, JSON.stringify(prev, null, 2));
      actions.appendChild(saveB);
      const pubB = el(`<button class="btn btn-gold">Publish LinkedIn post</button>`);
      pubB.onclick = () => publishFlow(li, actions);
      actions.appendChild(pubB);
      block.appendChild(actions);
      out.appendChild(block);
      toast('Pipeline complete', 'success');
    } catch (e) {
      const running = stepsBox.querySelector('.running');
      if (running) { running.classList.remove('running'); running.classList.add('error'); running.querySelector('.step-state').textContent = '✕'; }
      out.appendChild(errorBanner(e.message, goBtn.onclick));
    } finally {
      goBtn.disabled = false;
    }
  };
};

/* ── Saved Outputs ── */
views.saved = (root) => {
  const card = el(`<div class="card"><h2>Saved Outputs</h2><p class="sub">Stored in this browser (localStorage) — export anything important.</p></div>`);
  root.append(card);
  const items = store.saved;
  if (!items.length) {
    card.appendChild(emptyState('📁', 'No saved outputs', 'Anything you Save from the generators or campaigns lands here.'));
    return;
  }
  items.forEach((item) => {
    const row = el(`
      <div class="saved-item">
        <div class="saved-meta">
          <strong>${esc(item.title)}</strong>
          <span>${esc(item.type)} · ${new Date(item.at).toLocaleString()}</span>
          <div class="saved-preview">${esc(item.content.slice(0, 200))}</div>
        </div>
      </div>
    `);
    const actions = el(`<div class="btn-row"></div>`);
    actions.appendChild(copyBtn(() => item.content));
    const delB = el(`<button class="btn btn-danger">Delete</button>`);
    delB.onclick = () => { store.saved = store.saved.filter((i) => i.id !== item.id); render(); toast('Deleted'); };
    actions.appendChild(delB);
    row.appendChild(actions);
    card.appendChild(row);
  });
  function render() { root.innerHTML = ''; views.saved(root); }
};

/* ── Settings ── */
views.settings = (root) => {
  root.append(el(`
    <div>
      <div class="card">
        <h2>Connection</h2>
        <p class="sub">The API secret is the MARKETING_TRIGGER_SECRET set on the server (Vercel env var). Stored only in this browser.</p>
        <label class="field"><span>API secret</span>
          <input type="password" id="set-secret" value="${esc(store.secret)}" placeholder="paste MARKETING_TRIGGER_SECRET" />
        </label>
        <div class="btn-row">
          <button class="btn btn-primary" id="set-save">Save & test connection</button>
        </div>
        <div id="set-result"></div>
      </div>
      <div class="card">
        <h2>About this studio</h2>
        <p class="sub">
          Publishing goes through a server-side fact-check gate (the Verifier agent) — posts with
          unsupported claims are blocked, same as the automated daily poster. Saved Outputs and chat
          history live only in this browser. The daily 9 AM PKT auto-post runs on the Mac via launchd,
          not from this dashboard.
        </p>
      </div>
    </div>
  `));
  root.querySelector('#set-save').onclick = async () => {
    store.secret = root.querySelector('#set-secret').value.trim();
    const result = root.querySelector('#set-result');
    result.innerHTML = '';
    const ok = await checkConnection();
    result.appendChild(el(ok
      ? `<div class="banner banner-success">✓ Connected — secret accepted by the server.</div>`
      : `<div class="banner banner-error">Could not connect — check the secret and that the server env vars are set.</div>`));
  };
};

/* ══ Router ═══════════════════════════════════════════════════ */

const TITLES = {
  dashboard: 'Dashboard', chat: 'AI Marketing Chat', campaign: 'Campaign Generator',
  social: 'Social Post Generator', adcopy: 'Ad Copy Generator', funnel: 'Funnel Planner',
  saved: 'Saved Outputs', settings: 'Settings',
};

function route() {
  const name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  const view = views[name] || views.dashboard;
  document.getElementById('page-title').textContent = TITLES[name] || 'Dashboard';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  const root = document.getElementById('view');
  root.innerHTML = '';
  // First-run: force Settings until a secret exists.
  if (!store.secret && name !== 'settings') {
    root.appendChild(el(`<div class="banner banner-info">👋 First time here — set the API secret in <a href="#/settings">Settings</a> to connect.</div>`));
  }
  view(root);
  document.getElementById('sidebar').classList.remove('open');
}

window.addEventListener('hashchange', route);
document.getElementById('menu-btn').onclick = () => document.getElementById('sidebar').classList.toggle('open');
route();
checkConnection();
