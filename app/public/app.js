/* StarBoard — Employee Gamification SaaS (vanilla SPA) */
'use strict';

const API = '/api';
const state = {
  token: localStorage.getItem('sb_token') || null,
  user: null,
  org: null,
  page: null,
  cache: {},
};

const EMOJIS = ['🙂','😎','👩‍💻','🧑‍💼','🎨','🎧','📊','🚀','🦊','🐼','🦁','🐯','🌟','🔥','⚡','🍀','🎯','🧠','💎','👑','🦸','🧑‍🔬'];
const REWARD_ICONS = ['🍕','☕','🎁','🏖️','🧥','💳','🅿️','🍽️','🎟️','🎮','📚','🏆','🎉','💰','🍩','🎫'];

/* ============================================================
   FX engine — sound, confetti, floating XP, celebrations
   ============================================================ */
const FX = (() => {
  let soundOn = localStorage.getItem('sb_sound') !== 'off';
  let actx = null;
  const ac = () => (actx || (actx = new (window.AudioContext || window.webkitAudioContext)()));

  function tone(freq, dur, type = 'sine', gain = 0.06, when = 0) {
    if (!soundOn) return;
    try {
      const ctx = ac(); const t = ctx.currentTime + when;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur);
    } catch {}
  }
  const seq = (notes, type, gain) => notes.forEach(([f, w, d]) => tone(f, d || 0.16, type, gain, w));

  const sound = (kind) => {
    switch (kind) {
      case 'click': tone(420, 0.06, 'triangle', 0.04); break;
      case 'success': seq([[660, 0], [880, 0.08]], 'triangle', 0.05); break;
      case 'coin': seq([[988, 0], [1319, 0.07]], 'square', 0.04); break;
      case 'levelup': seq([[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32, 0.4]], 'triangle', 0.06); break;
      case 'reward': seq([[784, 0], [988, 0.09], [1319, 0.2, 0.4]], 'triangle', 0.06); break;
      case 'error': tone(180, 0.22, 'sawtooth', 0.05); break;
      case 'whoosh': tone(300, 0.18, 'sine', 0.03); break;
    }
  };

  // confetti
  let canvas, ctx, pieces = [], raf = null;
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'fx-canvas';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d'); resize();
    window.addEventListener('resize', resize);
  }
  function resize() { if (!canvas) return; canvas.width = innerWidth; canvas.height = innerHeight; }
  const COLORS = ['#ffd23f', '#34e0ff', '#7c9bff', '#b56bff', '#ff5fa2', '#2ce6a8', '#ff9d2e'];
  function confetti(x, y, count = 90) {
    ensureCanvas();
    x = x == null ? innerWidth / 2 : x; y = y == null ? innerHeight / 3 : y;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      pieces.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: 0.18 + Math.random() * 0.12,
        s: 5 + Math.random() * 7, c: COLORS[(Math.random() * COLORS.length) | 0], rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.4, life: 70 + Math.random() * 40, t: 0, shape: Math.random() < 0.4 });
    }
    if (!raf) loop();
  }
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces = pieces.filter(p => p.t < p.life);
    pieces.forEach(p => {
      p.t++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.c;
      if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.28); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    });
    if (pieces.length) raf = requestAnimationFrame(loop); else { cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  // floating "+XP" text
  function floatText(text, x, y, color) {
    const d = document.createElement('div'); d.className = 'float-xp'; d.textContent = text;
    if (color) d.style.color = color;
    d.style.left = (x - 20) + 'px'; d.style.top = (y - 20) + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 1300);
  }
  // emit float from an event/element
  function pop(text, evtOrEl, color) {
    let x = innerWidth / 2, y = innerHeight / 2;
    if (evtOrEl && evtOrEl.clientX != null) { x = evtOrEl.clientX; y = evtOrEl.clientY; }
    else if (evtOrEl && evtOrEl.getBoundingClientRect) { const r = evtOrEl.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    floatText(text, x, y, color);
  }

  // full-screen celebration
  function celebrate(emoji, title, sub) {
    sound('levelup'); confetti(innerWidth / 2, innerHeight / 3, 140);
    const o = document.createElement('div'); o.className = 'celebrate-overlay';
    o.innerHTML = `<div class="celebrate-card"><div class="big">${emoji}</div><h2>${title}</h2><p>${sub || ''}</p></div>`;
    document.body.appendChild(o);
    setTimeout(() => confetti(innerWidth / 3, innerHeight / 2.5, 80), 250);
    setTimeout(() => confetti(innerWidth * 2 / 3, innerHeight / 2.5, 80), 450);
    const close = () => { o.style.opacity = '0'; o.style.transition = 'opacity .3s'; setTimeout(() => o.remove(), 300); };
    o.addEventListener('click', close); setTimeout(close, 2600);
  }

  // count-up numbers inside a container
  function animateCounts(root) {
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = parseInt(el.getAttribute('data-count'), 10);
      if (isNaN(to)) return;
      const dur = 700, start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(to * e).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  const toggle = () => { soundOn = !soundOn; localStorage.setItem('sb_sound', soundOn ? 'on' : 'off'); if (soundOn) sound('success'); return soundOn; };
  const isOn = () => soundOn;
  return { sound, confetti, pop, floatText, celebrate, animateCounts, toggle, isOn };
})();

/* ---------------- helpers ---------------- */
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

function toast(msg, type = '') {
  const wrap = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  FX.sound(type === 'error' ? 'error' : type === 'success' ? 'success' : 'click');
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

function modal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg" id="mbg"><div class="modal">${html}</div></div>`;
  document.getElementById('mbg').addEventListener('click', (e) => { if (e.target.id === 'mbg') closeModal(); });
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
window.closeModal = closeModal;

function logout() {
  state.token = null; state.user = null; state.org = null;
  localStorage.removeItem('sb_token');
  render();
}

/* ---------------- boot ---------------- */
async function boot() {
  if (state.token) {
    try {
      const me = await api('/auth/me');
      state.user = me.user; state.org = me.org;
    } catch { state.token = null; localStorage.removeItem('sb_token'); }
  }
  render();
}

function render() {
  const root = document.getElementById('root');
  if (!state.user) { renderAuth(root); return; }
  renderShell(root);
}

/* ---------------- AUTH ---------------- */
let authMode = location.hash.replace('#', '') === 'signup' ? 'signup' : 'login';
function renderAuth(root) {
  root.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <a href="/" class="muted" style="font-size:13px;display:inline-block;margin-bottom:14px">← Back to home</a>
      <div class="brand-logo"><span class="mark">⭐</span> StarBoard</div>
      <p class="muted" style="margin-top:8px">Gamify work. Reward people. Grow culture.</p>
      <div class="auth-tabs">
        <button data-m="login" class="${authMode==='login'?'active':''}">Sign in</button>
        <button data-m="signup" class="${authMode==='signup'?'active':''}">Create organization</button>
      </div>
      <form id="authForm">
        ${authMode === 'signup' ? `
          <label>Organization name</label><input name="orgName" placeholder="Acme Inc." required />
          <label>Your name</label><input name="name" placeholder="Jane Doe" required />
        ` : ''}
        <label>Email</label><input name="email" type="email" placeholder="you@company.com" required />
        <label>Password</label><input name="password" type="password" placeholder="••••••••" required />
        <div id="authErr"></div>
        <button class="btn" style="width:100%;margin-top:18px" type="submit">
          ${authMode === 'signup' ? 'Create organization' : 'Sign in'}
        </button>
      </form>
      <div class="demo-creds">
        <b>Demo logins</b> (click to fill):<br/>
        🛡️ Super admin · <code data-fill="abdullah.alhejji99@gmail.com|super1234">abdullah.alhejji99@gmail.com</code><br/>
        👑 Org admin · <code data-fill="admin@acme.com|password123">admin@acme.com</code><br/>
        📊 Employee · <code data-fill="maya@acme.com|password123">maya@acme.com</code><br/>
        <span class="muted">password for demo org accounts: password123</span>
      </div>
    </div>
  </div>`;

  root.querySelectorAll('.auth-tabs button').forEach((b) =>
    b.addEventListener('click', () => { authMode = b.dataset.m; renderAuth(root); })
  );
  root.querySelectorAll('[data-fill]').forEach((c) =>
    c.addEventListener('click', () => {
      const [em, pw] = c.dataset.fill.split('|');
      authMode = 'login'; renderAuth(root);
      root.querySelector('[name=email]').value = em;
      root.querySelector('[name=password]').value = pw;
    })
  );

  root.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const errBox = root.querySelector('#authErr');
    errBox.innerHTML = '';
    try {
      const path = authMode === 'signup' ? '/auth/signup' : '/auth/login';
      const out = await api(path, { method: 'POST', body: f });
      state.token = out.token; state.user = out.user; state.org = out.org;
      localStorage.setItem('sb_token', out.token);
      toast('Welcome, ' + out.user.name.split(' ')[0] + '!', 'success');
      FX.sound('whoosh'); setTimeout(() => FX.confetti(window.innerWidth / 2, window.innerHeight / 2.2, 110), 200);
      state.page = null;
      render();
    } catch (err) {
      errBox.innerHTML = `<div class="error-banner">${esc(err.message)}</div>`;
    }
  });
}

/* ---------------- SHELL ---------------- */
function navFor(role) {
  if (role === 'super_admin') return [
    ['overview', '📊', 'Overview'],
    ['orgs', '🏢', 'Organizations'],
  ];
  if (role === 'org_admin') return [
    ['dashboard', '📊', 'Dashboard'],
    ['__d__', '', 'Work'],
    ['projects', '🗂️', 'Projects'],
    ['mywork', '✅', 'My Tasks'],
    ['inbox', '📥', 'Inbox'],
    ['goals', '🎯', 'Goals'],
    ['portfolios', '🗃️', 'Portfolios'],
    ['reporting', '📈', 'Reporting'],
    ['__d__', '', 'Engage'],
    ['tasks', '⚡', 'Quests'],
    ['challenges', '🔥', 'Challenges'],
    ['ideas', '💡', 'Ideas'],
    ['rewards', '🎁', 'Rewards'],
    ['redemptions', '🛍️', 'Redemptions'],
    ['members', '👥', 'Members'],
    ['leaderboard', '🏆', 'Leaderboard'],
  ];
  return [
    ['home', '🏠', 'Home'],
    ['__d__', '', 'Work'],
    ['projects', '🗂️', 'Projects'],
    ['mywork', '✅', 'My Tasks'],
    ['inbox', '📥', 'Inbox'],
    ['goals', '🎯', 'Goals'],
    ['portfolios', '🗃️', 'Portfolios'],
    ['reporting', '📈', 'Reporting'],
    ['__d__', '', 'Engage'],
    ['tasks', '⚡', 'Quests'],
    ['challenges', '🔥', 'Challenges'],
    ['ideas', '💡', 'Ideas'],
    ['shop', '🎁', 'Rewards Shop'],
    ['leaderboard', '🏆', 'Leaderboard'],
    ['profile', '🙂', 'My Profile'],
  ];
}

function defaultPage(role) {
  return role === 'super_admin' ? 'overview' : role === 'org_admin' ? 'dashboard' : 'home';
}

let pendingBadges = {};
function renderShell(root) {
  const role = state.user.role;
  if (!state.page) state.page = defaultPage(role);
  const items = navFor(role);

  root.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand-logo"><span class="mark">⭐</span> StarBoard</div>
      ${role !== 'super_admin' ? `<button class="nav-search" id="searchBtn"><span class="ic">🔍</span> Search…</button>` : ''}
      <div class="nav-scroll">
      ${items.map(([id, ic, label]) => id === '__d__'
        ? `<div class="nav-divider">${label}</div>`
        : `<button class="nav-item ${state.page === id ? 'active' : ''}" data-page="${id}">
          <span class="ic">${ic}</span> ${label}
          ${id === 'redemptions' && pendingBadges.redemptions ? `<span class="badge-count">${pendingBadges.redemptions}</span>` : ''}
          ${id === 'inbox' && pendingBadges.inbox ? `<span class="badge-count">${pendingBadges.inbox}</span>` : ''}
          ${id === 'tasks' && role === 'org_admin' && pendingBadges.review ? `<span class="badge-count">${pendingBadges.review}</span>` : ''}
        </button>`).join('')}
      </div>
      <div class="spacer"></div>
      ${role !== 'super_admin' ? `<div class="user-chip" style="margin-bottom:10px">
        <div class="av">${esc(state.user.avatar)}</div>
        <div class="grow">
          <div class="nm">${esc(state.user.name)}</div>
          <div class="rl">${role === 'employee' ? '⭐ ' + state.user.stars + ' stars · Lv ' + state.user.level : esc(state.org ? state.org.name : '')}</div>
        </div>
      </div>` : `<div class="user-chip" style="margin-bottom:10px">
        <div class="av">${esc(state.user.avatar)}</div>
        <div class="grow"><div class="nm">${esc(state.user.name)}</div><div class="rl">Platform owner</div></div>
      </div>`}
      <button class="sound-toggle" id="soundBtn" style="margin-bottom:8px"><span id="soundIc">${FX.isOn() ? '🔊' : '🔇'}</span> Sound ${FX.isOn() ? 'on' : 'off'}</button>
      <button class="nav-item" id="logoutBtn"><span class="ic">🚪</span> Sign out</button>
    </aside>
    <div>
      <div class="topbar">
        <button class="menu-btn" id="menuBtn">☰</button>
        <div class="brand-logo" style="font-size:18px"><span class="mark">⭐</span> StarBoard</div>
      </div>
      <main class="main" id="pageRoot"></main>
    </div>
  </div>`;

  root.querySelectorAll('.nav-item[data-page]').forEach((b) =>
    b.addEventListener('click', () => { state.page = b.dataset.page; document.getElementById('sidebar').classList.remove('open'); renderShell(root); })
  );
  root.querySelector('#logoutBtn').addEventListener('click', logout);
  root.querySelector('#soundBtn').addEventListener('click', (e) => {
    const on = FX.toggle();
    e.currentTarget.innerHTML = `<span>${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`;
  });
  const menuBtn = root.querySelector('#menuBtn');
  if (menuBtn) menuBtn.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  const searchBtn = root.querySelector('#searchBtn');
  if (searchBtn) searchBtn.addEventListener('click', searchModal);

  if (role !== 'super_admin') refreshInboxBadge();
  routePage();
}

async function refreshInboxBadge() {
  try {
    const { unread } = await api('/pm/inbox/count');
    if (unread !== pendingBadges.inbox) {
      pendingBadges.inbox = unread;
      const btn = document.querySelector('.nav-item[data-page="inbox"]');
      if (btn) {
        const old = btn.querySelector('.badge-count');
        if (old) old.remove();
        if (unread) btn.insertAdjacentHTML('beforeend', `<span class="badge-count">${unread}</span>`);
      }
    }
  } catch {}
}

function setHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row wrap">${actions}</div></div>`;
}

const PM_ROUTES = {
  projects: [pageProjects], mywork: [pageMyTasks], inbox: [pageInbox],
  goals: [pageGoals], portfolios: [pagePortfolios], reporting: [pageReporting],
};
const ROUTES = {
  super_admin: { overview: [pageSuperOverview], orgs: [pageSuperOrgs] },
  org_admin: {
    dashboard: [pageAdminDashboard], tasks: [pageTasks, true], challenges: [pageChallenges, true],
    ideas: [pageIdeas, true], rewards: [pageRewardsAdmin], redemptions: [pageRedemptions, true],
    members: [pageMembers], leaderboard: [pageLeaderboard], ...PM_ROUTES,
  },
  employee: {
    home: [pageEmployeeHome], tasks: [pageTasks, false], challenges: [pageChallenges, false],
    ideas: [pageIdeas, false], shop: [pageShop], leaderboard: [pageLeaderboard], profile: [pageProfile], ...PM_ROUTES,
  },
};

async function routePage() {
  const el = document.getElementById('pageRoot');
  el.innerHTML = `<div class="loader"><span class="spin">⭐</span><p class="muted" style="margin-top:14px;font-family:var(--font-head)">Loading…</p></div>`;
  try {
    const entry = (ROUTES[state.user.role] || {})[state.page];
    if (!entry) return;
    const [fn, ...args] = entry;
    await fn(el, ...args);
    FX.animateCounts(el);
  } catch (err) {
    el.innerHTML = `<div class="empty"><div class="ic">😵</div><p>${esc(err.message)}</p></div>`;
  }
}

async function refreshUser() {
  const prevLevel = state.user ? state.user.level : 1;
  try {
    const me = await api('/auth/me'); state.user = me.user; state.org = me.org;
    if (state.user.level > prevLevel) {
      setTimeout(() => FX.celebrate('🎉', 'LEVEL UP!', `You reached level ${state.user.level}`), 350);
    }
  } catch {}
}

/* ---------------- SUPER ADMIN ---------------- */
async function pageSuperOverview(el) {
  const s = await api('/super/stats');
  el.innerHTML = setHead('Platform Overview', 'StarBoard SaaS — all organizations at a glance') + `
    <div class="grid cols-4">
      ${stat('Organizations', s.orgs, '🏢', true)}
      ${stat('Active orgs', s.activeOrgs, '🟢')}
      ${stat('Total users', s.users, '👥')}
      ${stat('Points awarded', s.pointsAwarded, '⭐')}
    </div>
    <div class="grid cols-3" style="margin-top:16px">
      ${stat('Tasks created', s.tasks, '✅')}
      ${stat('Ideas submitted', s.ideas, '💡')}
      ${stat('Reward redemptions', s.redemptions, '🛍️')}
    </div>
    <div class="card" style="margin-top:18px">
      <h3>Welcome, platform owner 🛡️</h3>
      <p class="muted">This is your super-admin console. Provision new customer organizations, manage their plans and seats, and suspend or remove tenants. Each organization runs its own isolated gamification workspace with an admin and employees.</p>
      <button class="btn" id="goOrgs">Manage organizations →</button>
    </div>`;
  el.querySelector('#goOrgs').addEventListener('click', () => { state.page = 'orgs'; renderShell(document.getElementById('root')); });
}

async function pageSuperOrgs(el) {
  const orgs = await api('/super/orgs');
  el.innerHTML = setHead('Organizations', `${orgs.length} tenant${orgs.length===1?'':'s'} on the platform`,
    `<button class="btn" id="newOrg">+ New organization</button>`) + `
    <table>
      <thead><tr><th>Organization</th><th>Plan</th><th>Members</th><th>Activity</th><th>Admin</th><th>Status</th><th></th></tr></thead>
      <tbody>${orgs.map(o => `
        <tr>
          <td><div class="title-strong">${esc(o.name)}</div><div class="sub">/${esc(o.slug)} · since ${fmtDate(o.created_at)}</div></td>
          <td><span class="pill active" style="text-transform:capitalize">${esc(o.plan)}</span></td>
          <td>${o.members} / ${o.seats}</td>
          <td class="sub">${o.tasks} tasks · ${o.ideas} ideas</td>
          <td class="sub">${esc(o.admin_email || '—')}</td>
          <td><span class="pill ${o.status}">${o.status}</span></td>
          <td class="row">
            <button class="btn ghost sm" data-edit="${o.id}">Edit</button>
            <button class="btn ghost sm" data-toggle="${o.id}">${o.status === 'active' ? 'Suspend' : 'Activate'}</button>
            <button class="btn danger sm" data-del="${o.id}">✕</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  el.querySelector('#newOrg').addEventListener('click', () => orgModal());
  el.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
    const o = orgs.find(x => x.id == b.dataset.toggle);
    await api('/super/orgs/' + o.id, { method: 'PATCH', body: { status: o.status === 'active' ? 'suspended' : 'active' } });
    toast('Organization updated', 'success'); routePage();
  }));
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    orgModal(orgs.find(x => x.id == b.dataset.edit));
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const o = orgs.find(x => x.id == b.dataset.del);
    if (!confirm(`Delete "${o.name}" and ALL its data? This cannot be undone.`)) return;
    await api('/super/orgs/' + o.id, { method: 'DELETE' });
    toast('Organization deleted'); routePage();
  }));
}

function orgModal(existing) {
  const e = existing || {};
  modal(`
    <h2>${existing ? 'Edit organization' : 'New organization'}</h2>
    <p class="muted">${existing ? 'Update plan, seats and status.' : 'Provision a new tenant and its first admin account.'}</p>
    <form id="orgForm">
      <label>Organization name</label><input name="orgName" value="${esc(e.name || '')}" required />
      <div class="row"><div class="grow"><label>Plan</label>
        <select name="plan"><option ${e.plan==='free'?'selected':''}>free</option><option ${e.plan==='pro'?'selected':''}>pro</option><option ${e.plan==='enterprise'?'selected':''}>enterprise</option></select>
      </div><div class="grow"><label>Seats</label><input name="seats" type="number" value="${e.seats || 25}" /></div></div>
      ${existing ? '' : `
        <label>Admin name</label><input name="adminName" required />
        <label>Admin email</label><input name="adminEmail" type="email" required />
        <label>Admin password</label><input name="adminPassword" type="password" required />`}
      <div class="actions">
        <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn">${existing ? 'Save' : 'Create'}</button>
      </div>
    </form>`);
  document.getElementById('orgForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      if (existing) await api('/super/orgs/' + existing.id, { method: 'PATCH', body: { name: f.orgName, plan: f.plan, seats: f.seats } });
      else await api('/super/orgs', { method: 'POST', body: f });
      closeModal(); toast('Saved', 'success'); routePage();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- ADMIN DASHBOARD ---------------- */
async function pageAdminDashboard(el) {
  const a = await api('/analytics');
  pendingBadges.redemptions = a.pendingRedemptions; pendingBadges.review = a.pendingReview;
  el.innerHTML = setHead('Dashboard', `${esc(state.org.name)} · ${a.members} team members`) + `
    <div class="grid cols-4">
      ${stat('Team members', a.members, '👥', true)}
      ${stat('Active challenges', a.challenges, '🔥')}
      ${stat('Stars in circulation', a.starsInCirculation, '⭐')}
      ${stat('Points awarded', a.pointsAwarded, '📈')}
    </div>
    <div class="grid cols-4" style="margin-top:16px">
      ${stat('Tasks to review', a.pendingReview, '🔎', a.pendingReview>0)}
      ${stat('Open tasks', a.tasksOpen, '✅')}
      ${stat('New ideas', a.ideasPending, '💡')}
      ${stat('Redemptions to fulfil', a.pendingRedemptions, '🛍️', a.pendingRedemptions>0)}
    </div>
    <div class="grid cols-2" style="margin-top:18px">
      <div class="card">
        <h3>🏆 Top performers</h3>
        ${a.topMembers.length ? a.topMembers.map((m,i) => `
          <div class="list-item"><div class="rank-medal">${['🥇','🥈','🥉'][i]||'#'+(i+1)}</div>
            <div class="avatar-sm">${esc(m.avatar)}</div>
            <div class="grow"><div class="title-strong">${esc(m.name)}</div></div>
            <div class="stars">${m.points} pts</div></div>`).join('') : '<p class="muted">No data yet.</p>'}
      </div>
      <div class="card">
        <h3>⚡ Recent activity</h3>
        ${a.recent.length ? a.recent.map(r => `
          <div class="list-item" style="padding:10px">
            <div class="grow"><div class="title-strong" style="font-size:13px">${esc(r.user_name)}</div>
            <div class="sub">${esc(r.reason)}</div></div>
            <div class="stars">${r.amount>0?'+':''}${r.amount}</div></div>`).join('') : '<p class="muted">No activity yet.</p>'}
      </div>
    </div>`;
}

/* ---------------- TASKS ---------------- */
let taskFilter = 'all';
async function pageTasks(el, isAdmin) {
  const [tasks, members] = await Promise.all([
    api('/tasks'),
    isAdmin ? api('/members') : Promise.resolve([]),
  ]);
  if (isAdmin) pendingBadges.review = tasks.filter(t => t.status === 'submitted').length;
  const mine = isAdmin ? tasks : tasks.filter(t => t.assigned_to === state.user.id || t.status === 'open');
  const filters = ['all','open','in_progress','submitted','completed'];
  const shown = taskFilter === 'all' ? mine : mine.filter(t => t.status === taskFilter);

  el.innerHTML = setHead(isAdmin ? 'Tasks' : 'My Tasks',
    isAdmin ? 'Create, assign and approve tasks to award points' : 'Claim open tasks, do the work, earn stars',
    isAdmin ? `<button class="btn" id="newTask">+ New task</button>` : '') + `
    <div class="tabs">${filters.map(f => `<button data-f="${f}" class="${taskFilter===f?'active':''}">${f.replace('_',' ')}</button>`).join('')}</div>
    <div class="grid auto">${shown.length ? shown.map(t => taskCard(t, isAdmin)).join('') : emptyState('No tasks here','✅')}</div>`;

  el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { taskFilter = b.dataset.f; pageTasks(el, isAdmin); }));
  if (isAdmin) {
    const nt = el.querySelector('#newTask');
    if (nt) nt.addEventListener('click', () => taskModal(members));
    el.querySelectorAll('[data-edit-task]').forEach(b => b.addEventListener('click', () => taskModal(members, tasks.find(t => t.id == b.dataset.editTask))));
  }
  bindTaskActions(el, isAdmin);
}

function taskCard(t, isAdmin) {
  const canClaim = !isAdmin && t.status === 'open';
  const canSubmit = !isAdmin && t.assigned_to === state.user.id && t.status === 'in_progress';
  const canApprove = isAdmin && t.status === 'submitted';
  return `<div class="card">
    <div class="row spread"><span class="pill ${t.status}">${t.status.replace('_',' ')}</span><span class="pill ${t.priority}">${t.priority}</span></div>
    <div class="title-strong" style="margin-top:10px;font-size:15px">${esc(t.title)}</div>
    <div class="sub" style="margin:6px 0 10px">${esc(t.description) || 'No description'}</div>
    <div class="row spread">
      <div class="sub">${t.assignee_name ? esc(t.assignee_avatar)+' '+esc(t.assignee_name) : '🟢 Open to claim'}</div>
      <div class="stars">⭐ ${t.points}</div>
    </div>
    <div class="row wrap" style="margin-top:12px">
      ${canClaim ? `<button class="btn sm" data-claim="${t.id}">Claim task</button>` : ''}
      ${canSubmit ? `<button class="btn success sm" data-submit="${t.id}">Mark done</button>` : ''}
      ${canApprove ? `<button class="btn success sm" data-approve="${t.id}">Approve · +${t.points}</button><button class="btn ghost sm" data-reject="${t.id}">Send back</button>` : ''}
      ${isAdmin ? `<button class="btn ghost sm" data-edit-task="${t.id}">Edit</button><button class="btn danger sm" data-del-task="${t.id}">✕</button>` : ''}
    </div>
  </div>`;
}

function bindTaskActions(el, isAdmin) {
  const act = async (id, path, msg, ev, fx) => {
    try {
      await api(`/tasks/${id}/${path}`, { method: 'POST' });
      toast(msg, 'success');
      if (fx) fx(ev);
      await refreshUser(); renderShell(document.getElementById('root'));
    } catch (e) { toast(e.message, 'error'); }
  };
  el.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', (e) => { FX.sound('whoosh'); act(b.dataset.claim, 'claim', 'Task claimed! Time to shine ✨', e); }));
  el.querySelectorAll('[data-submit]').forEach(b => b.addEventListener('click', (e) => act(b.dataset.submit, 'submit', 'Submitted for review 🚀', e, (ev) => { FX.sound('whoosh'); })));
  el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', (e) => {
    const pts = b.textContent.replace(/[^0-9]/g, '');
    act(b.dataset.approve, 'approve', 'Approved & points awarded! 🎉', e, (ev) => { FX.sound('coin'); FX.confetti(ev.clientX, ev.clientY, 70); if (pts) FX.pop('+' + pts + '★', ev); });
  }));
  el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', (e) => act(b.dataset.reject, 'reject', 'Sent back', e)));
  el.querySelectorAll('[data-del-task]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Delete this task?'))return; await api('/tasks/'+b.dataset.delTask,{method:'DELETE'}); toast('Deleted'); pageTasks(el, isAdmin); }));
}

function taskModal(members, t) {
  const e = t || {};
  modal(`
    <h2>${t ? 'Edit task' : 'New task'}</h2>
    <form id="taskForm">
      <label>Title</label><input name="title" value="${esc(e.title||'')}" required />
      <label>Description</label><textarea name="description">${esc(e.description||'')}</textarea>
      <div class="row"><div class="grow"><label>Points</label><input name="points" type="number" value="${e.points||10}" /></div>
      <div class="grow"><label>Priority</label><select name="priority"><option ${e.priority==='low'?'selected':''}>low</option><option ${(!e.priority||e.priority==='medium')?'selected':''}>medium</option><option ${e.priority==='high'?'selected':''}>high</option></select></div></div>
      <label>Assign to</label>
      <select name="assigned_to"><option value="">— Open (anyone can claim) —</option>
        ${members.filter(m=>m.role==='employee').map(m => `<option value="${m.id}" ${e.assigned_to==m.id?'selected':''}>${esc(m.avatar)} ${esc(m.name)}</option>`).join('')}</select>
      <label>Due date</label><input name="due_date" type="date" value="${e.due_date||''}" />
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">${t?'Save':'Create'}</button></div>
    </form>`);
  document.getElementById('taskForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      if (t) await api('/tasks/'+t.id, { method:'PATCH', body:f });
      else await api('/tasks', { method:'POST', body:f });
      closeModal(); toast('Saved','success'); routePage();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ---------------- CHALLENGES ---------------- */
async function pageChallenges(el, isAdmin) {
  const ch = await api('/challenges');
  el.innerHTML = setHead('Challenges', isAdmin ? 'Run team challenges with point rewards' : 'Join challenges, log progress, earn big',
    isAdmin ? `<button class="btn" id="newCh">+ New challenge</button>` : '') + `
    <div class="grid auto">${ch.length ? ch.map(c => challengeCard(c, isAdmin)).join('') : emptyState('No challenges yet','🔥')}</div>`;
  if (isAdmin) {
    el.querySelector('#newCh').addEventListener('click', () => challengeModal());
    el.querySelectorAll('[data-edit-ch]').forEach(b => b.addEventListener('click', () => challengeModal(ch.find(c => c.id == b.dataset.editCh))));
    el.querySelectorAll('[data-del-ch]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Delete challenge?'))return; await api('/challenges/'+b.dataset.delCh,{method:'DELETE'}); toast('Deleted'); routePage(); }));
  } else {
    el.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', async (e) => { FX.sound('whoosh'); await api('/challenges/'+b.dataset.join+'/join',{method:'POST'}); toast('Joined challenge! Let\'s go 🔥','success'); FX.pop('JOINED!', e, '#34e0ff'); routePage(); }));
    el.querySelectorAll('[data-prog]').forEach(b => b.addEventListener('click', async (e) => {
      try { const r = await api('/challenges/'+b.dataset.prog+'/progress',{method:'POST',body:{amount:1}});
        if (r.completed) { FX.celebrate('🔥', 'CHALLENGE COMPLETE!', 'Points dropped into your balance'); }
        else { FX.sound('coin'); FX.pop('+1', e, '#34e0ff'); toast('Progress logged 💪','success'); }
        await refreshUser(); renderShell(document.getElementById('root'));
      } catch(e2){ toast(e2.message,'error'); }
    }));
  }
}

function challengeCard(c, isAdmin) {
  const me = c.me;
  const prog = me ? Math.round((me.progress / c.goal) * 100) : 0;
  return `<div class="card">
    <div class="row spread"><span class="pill ${c.status}">${c.status}</span><div class="stars">⭐ ${c.points}</div></div>
    <div class="title-strong" style="margin-top:10px;font-size:15px">${esc(c.title)}</div>
    <div class="sub" style="margin:6px 0 8px">${esc(c.description)}</div>
    <div class="sub">🎯 Goal: ${c.goal} ${esc(c.unit)} · 👥 ${c.participants} joined · 🏁 ${c.finishers} finished</div>
    ${me ? `<div class="progress"><span style="width:${prog}%"></span></div>
      <div class="sub" style="margin-top:6px">${me.completed ? '✅ Completed!' : `${me.progress}/${c.goal} ${esc(c.unit)}`}</div>` : ''}
    <div class="row wrap" style="margin-top:12px">
      ${!isAdmin && !me ? `<button class="btn sm" data-join="${c.id}">Join challenge</button>` : ''}
      ${!isAdmin && me && !me.completed ? `<button class="btn success sm" data-prog="${c.id}">+1 ${esc(c.unit)}</button>` : ''}
      ${isAdmin ? `<button class="btn ghost sm" data-edit-ch="${c.id}">Edit</button><button class="btn danger sm" data-del-ch="${c.id}">✕</button>` : ''}
    </div>
  </div>`;
}

function challengeModal(c) {
  const e = c || {};
  modal(`
    <h2>${c?'Edit challenge':'New challenge'}</h2>
    <form id="chForm">
      <label>Title</label><input name="title" value="${esc(e.title||'')}" required />
      <label>Description</label><textarea name="description">${esc(e.description||'')}</textarea>
      <div class="row"><div class="grow"><label>Reward points</label><input name="points" type="number" value="${e.points||50}" /></div>
      <div class="grow"><label>Goal</label><input name="goal" type="number" value="${e.goal||10}" /></div>
      <div class="grow"><label>Unit</label><input name="unit" value="${esc(e.unit||'steps')}" /></div></div>
      <label>End date</label><input name="end_date" type="date" value="${e.end_date||''}" />
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">${c?'Save':'Create'}</button></div>
    </form>`);
  document.getElementById('chForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try { if (c) await api('/challenges/'+c.id,{method:'PATCH',body:f}); else await api('/challenges',{method:'POST',body:f}); closeModal(); toast('Saved','success'); routePage(); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- IDEAS ---------------- */
async function pageIdeas(el, isAdmin) {
  const ideas = await api('/ideas');
  if (isAdmin) pendingBadges.ideas = ideas.filter(i => i.status === 'pending').length;
  el.innerHTML = setHead('Idea Box', isAdmin ? 'Review and reward employee ideas' : 'Share ideas to improve the organization — earn stars',
    !isAdmin ? `<button class="btn" id="newIdea">+ Submit idea</button>` : '') + `
    <div class="grid cols-2">${ideas.length ? ideas.map(i => ideaCard(i, isAdmin)).join('') : emptyState('No ideas yet — be the first!','💡')}</div>`;

  if (!isAdmin) { const b = el.querySelector('#newIdea'); if (b) b.addEventListener('click', () => ideaModal()); }
  el.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', async (e) => {
    try { const r = await api('/ideas/'+b.dataset.vote+'/vote',{method:'POST'}); if (r.voted) { FX.sound('coin'); FX.pop('▲', e, '#34e0ff'); } else FX.sound('click'); toast(r.voted?'Upvoted! 👍':'Vote removed'); routePage(); } catch(e2){ toast(e2.message,'error'); }
  }));
  if (isAdmin) {
    el.querySelectorAll('[data-status]').forEach(s => s.addEventListener('change', async () => {
      try { await api('/ideas/'+s.dataset.status,{method:'PATCH',body:{status:s.value}}); toast('Idea updated','success'); routePage(); } catch(e){ toast(e.message,'error'); routePage(); }
    }));
  }
  el.querySelectorAll('[data-del-idea]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Delete idea?'))return; await api('/ideas/'+b.dataset.delIdea,{method:'DELETE'}); toast('Deleted'); routePage(); }));
}

function ideaCard(i, isAdmin) {
  const statuses = ['pending','under_review','approved','implemented','rejected'];
  const canDelete = isAdmin || i.user_id === state.user.id;
  return `<div class="card idea-card">
    <button class="vote-btn ${i.voted?'voted':''}" data-vote="${i.id}">▲<span>${i.votes}</span></button>
    <div class="grow">
      <div class="row spread"><div class="title-strong">${esc(i.title)}</div><span class="pill ${i.status}">${i.status.replace('_',' ')}</span></div>
      <div class="sub" style="margin:6px 0">${esc(i.description)}</div>
      <div class="row spread">
        <div class="sub">${esc(i.author_avatar||'🙂')} ${esc(i.author||'Unknown')} · ${esc(i.category)}</div>
        ${canDelete ? `<button class="btn danger sm" data-del-idea="${i.id}">✕</button>` : ''}
      </div>
      ${isAdmin ? `<label style="margin-top:10px">Set status (approve = +40★, implement = +100★)</label>
        <select data-status="${i.id}">${statuses.map(s => `<option ${i.status===s?'selected':''} value="${s}">${s.replace('_',' ')}</option>`).join('')}</select>` : ''}
    </div>
  </div>`;
}

function ideaModal() {
  modal(`
    <h2>💡 Submit an idea</h2>
    <p class="muted">Good ideas earn stars — and approved ones earn even more.</p>
    <form id="ideaForm">
      <label>Title</label><input name="title" placeholder="What's your idea?" required />
      <label>Category</label>
      <select name="category"><option>general</option><option>culture</option><option>workplace</option><option>product</option><option>innovation</option><option>hr</option></select>
      <label>Describe it</label><textarea name="description" placeholder="How would it help the organization?"></textarea>
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">Submit (+5★)</button></div>
    </form>`);
  document.getElementById('ideaForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/ideas',{method:'POST',body:Object.fromEntries(new FormData(ev.target))}); closeModal(); toast('Idea submitted! +5 stars 💡','success'); FX.sound('coin'); FX.confetti(window.innerWidth/2, window.innerHeight/2.3, 60); FX.floatText('+5★', window.innerWidth/2, window.innerHeight/2.3); await refreshUser(); renderShell(document.getElementById('root')); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- REWARDS (admin) ---------------- */
async function pageRewardsAdmin(el) {
  const rewards = await api('/rewards');
  el.innerHTML = setHead('Rewards Catalog', 'Define what employees can redeem their stars for',
    `<button class="btn" id="newReward">+ New reward</button>`) + `
    <div class="grid auto">${rewards.length ? rewards.map(r => `
      <div class="card reward-card">
        <div class="ic">${esc(r.icon)}</div>
        <div class="title-strong">${esc(r.title)} ${r.active?'':'<span class="pill disabled">inactive</span>'}</div>
        <div class="sub">${esc(r.description)}</div>
        <div class="row spread"><span class="cost">⭐ ${r.cost}</span><span class="sub">${r.stock<0?'Unlimited':r.stock+' left'}</span></div>
        <div class="row"><button class="btn ghost sm" data-edit-rw="${r.id}">Edit</button>
        <button class="btn ghost sm" data-toggle-rw="${r.id}">${r.active?'Disable':'Enable'}</button>
        <button class="btn danger sm" data-del-rw="${r.id}">✕</button></div>
      </div>`).join('') : emptyState('No rewards yet','🎁')}</div>`;
  el.querySelector('#newReward').addEventListener('click', () => rewardModal());
  el.querySelectorAll('[data-edit-rw]').forEach(b => b.addEventListener('click', () => rewardModal(rewards.find(r => r.id == b.dataset.editRw))));
  el.querySelectorAll('[data-toggle-rw]').forEach(b => b.addEventListener('click', async () => { const r = rewards.find(x=>x.id==b.dataset.toggleRw); await api('/rewards/'+r.id,{method:'PATCH',body:{active:r.active?0:1}}); toast('Updated','success'); routePage(); }));
  el.querySelectorAll('[data-del-rw]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Delete reward?'))return; await api('/rewards/'+b.dataset.delRw,{method:'DELETE'}); toast('Deleted'); routePage(); }));
}

function rewardModal(r) {
  const e = r || {};
  modal(`
    <h2>${r?'Edit reward':'New reward'}</h2>
    <form id="rwForm">
      <label>Icon</label><div class="emoji-pick" id="iconPick">${REWARD_ICONS.map(ic => `<button type="button" data-ic="${ic}" class="${(e.icon||'🎁')===ic?'sel':''}">${ic}</button>`).join('')}</div>
      <input type="hidden" name="icon" value="${e.icon||'🎁'}" />
      <label>Title</label><input name="title" value="${esc(e.title||'')}" required />
      <label>Description</label><textarea name="description">${esc(e.description||'')}</textarea>
      <div class="row"><div class="grow"><label>Cost (stars)</label><input name="cost" type="number" value="${e.cost||100}" /></div>
      <div class="grow"><label>Stock (-1 = ∞)</label><input name="stock" type="number" value="${e.stock!=null?e.stock:-1}" /></div></div>
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">${r?'Save':'Create'}</button></div>
    </form>`);
  const hidden = document.querySelector('#rwForm [name=icon]');
  document.querySelectorAll('#iconPick button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#iconPick button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); hidden.value = b.dataset.ic;
  }));
  document.getElementById('rwForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { const f = Object.fromEntries(new FormData(ev.target)); if (r) await api('/rewards/'+r.id,{method:'PATCH',body:f}); else await api('/rewards',{method:'POST',body:f}); closeModal(); toast('Saved','success'); routePage(); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- SHOP (employee) ---------------- */
async function pageShop(el) {
  const [rewards, redemptions] = await Promise.all([api('/rewards'), api('/redemptions')]);
  el.innerHTML = setHead('Rewards Shop', `You have <span class="stars">⭐ ${state.user.stars} stars</span> to spend`) + `
    <div class="grid auto">${rewards.map(r => {
      const afford = state.user.stars >= r.cost;
      const out = r.stock === 0;
      return `<div class="card reward-card">
        <div class="ic">${esc(r.icon)}</div>
        <div class="title-strong">${esc(r.title)}</div>
        <div class="sub grow">${esc(r.description)}</div>
        <div class="row spread"><span class="cost">⭐ ${r.cost}</span>${r.stock<0?'':`<span class="sub">${r.stock} left</span>`}</div>
        <button class="btn ${afford&&!out?'':'ghost'}" data-redeem="${r.id}" ${afford&&!out?'':'disabled'}>${out?'Out of stock':afford?'Redeem':'Need '+(r.cost-state.user.stars)+' more ★'}</button>
      </div>`;
    }).join('')}</div>
    <h3 style="margin-top:26px">🛍️ My redemptions</h3>
    ${redemptions.length ? redemptions.map(r => `
      <div class="list-item"><div class="avatar-sm">🎁</div>
        <div class="grow"><div class="title-strong">${esc(r.reward_title)}</div><div class="sub">${fmtDate(r.created_at)} · ⭐ ${r.cost}</div></div>
        <span class="pill ${r.status}">${r.status}</span></div>`).join('') : '<p class="muted">No redemptions yet — treat yourself!</p>'}`;

  el.querySelectorAll('[data-redeem]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Redeem this reward with your stars?')) return;
    const icon = b.closest('.card').querySelector('.ic')?.textContent || '🎁';
    const title = b.closest('.card').querySelector('.title-strong')?.textContent || 'Reward';
    try { const r = await api('/rewards/'+b.dataset.redeem+'/redeem',{method:'POST'}); state.user = r.user; FX.celebrate(icon, 'REDEEMED!', `${title} — pending fulfilment`); toast('Redeemed! Check with your admin 🎁','success'); renderShell(document.getElementById('root')); }
    catch(e){ toast(e.message,'error'); }
  }));
}

/* ---------------- REDEMPTIONS (admin) ---------------- */
async function pageRedemptions(el, isAdmin) {
  const reds = await api('/redemptions');
  pendingBadges.redemptions = reds.filter(r => r.status === 'pending').length;
  el.innerHTML = setHead('Redemptions', 'Approve and fulfil reward requests') + `
    <table><thead><tr><th>Member</th><th>Reward</th><th>Cost</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>${reds.length ? reds.map(r => `
      <tr>
        <td><div class="row"><div class="avatar-sm">${esc(r.user_avatar)}</div> ${esc(r.user_name)}</div></td>
        <td>${esc(r.reward_title)}</td><td class="stars">⭐ ${r.cost}</td><td class="sub">${fmtDate(r.created_at)}</td>
        <td><span class="pill ${r.status}">${r.status}</span></td>
        <td class="row">
          ${r.status==='pending'?`<button class="btn success sm" data-set="${r.id}|approved">Approve</button>`:''}
          ${r.status==='approved'?`<button class="btn success sm" data-set="${r.id}|fulfilled">Mark fulfilled</button>`:''}
          ${r.status!=='rejected'&&r.status!=='fulfilled'?`<button class="btn danger sm" data-set="${r.id}|rejected">Reject (refund)</button>`:''}
        </td>
      </tr>`).join('') : '<tr><td colspan="6" class="center muted" style="padding:30px">No redemptions yet.</td></tr>'}
    </tbody></table>`;
  el.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', async () => {
    const [id, status] = b.dataset.set.split('|');
    try { await api('/redemptions/'+id,{method:'PATCH',body:{status}}); toast('Updated'+(status==='rejected'?' & refunded':''),'success'); routePage(); }
    catch(e){ toast(e.message,'error'); }
  }));
}

/* ---------------- MEMBERS ---------------- */
async function pageMembers(el) {
  const members = await api('/members');
  el.innerHTML = setHead('Members', `${members.length} people in ${esc(state.org.name)}`,
    `<button class="btn" id="newMember">+ Add member</button>`) + `
    <table><thead><tr><th>Member</th><th>Role</th><th>Level</th><th>Points</th><th>Stars</th><th>Status</th><th></th></tr></thead>
    <tbody>${members.map(m => `
      <tr>
        <td><div class="row"><div class="avatar-sm">${esc(m.avatar)}</div><div><div class="title-strong">${esc(m.name)}</div><div class="sub">${esc(m.email)}${m.title?' · '+esc(m.title):''}</div></div></div></td>
        <td><span class="pill ${m.role==='org_admin'?'in_progress':'open'}">${m.role.replace('org_','').replace('_',' ')}</span></td>
        <td>Lv ${m.level}</td><td>${m.points}</td><td class="stars">⭐ ${m.stars}</td>
        <td><span class="pill ${m.status}">${m.status}</span></td>
        <td class="row">
          <button class="btn ghost sm" data-award="${m.id}">+ Pts</button>
          <button class="btn ghost sm" data-edit-m="${m.id}">Edit</button>
          ${m.id!==state.user.id?`<button class="btn danger sm" data-del-m="${m.id}">✕</button>`:''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  el.querySelector('#newMember').addEventListener('click', () => memberModal());
  el.querySelectorAll('[data-edit-m]').forEach(b => b.addEventListener('click', () => memberModal(members.find(m => m.id == b.dataset.editM))));
  el.querySelectorAll('[data-award]').forEach(b => b.addEventListener('click', () => awardModal(members.find(m => m.id == b.dataset.award))));
  el.querySelectorAll('[data-del-m]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Remove this member?'))return; await api('/members/'+b.dataset.delM,{method:'DELETE'}); toast('Removed'); routePage(); }));
}

function memberModal(m) {
  const e = m || {};
  modal(`
    <h2>${m?'Edit member':'Add member'}</h2>
    <form id="mForm">
      <label>Avatar</label><div class="emoji-pick" id="avPick">${EMOJIS.map(ic => `<button type="button" data-ic="${ic}" class="${(e.avatar||'🙂')===ic?'sel':''}">${ic}</button>`).join('')}</div>
      <input type="hidden" name="avatar" value="${e.avatar||'🙂'}" />
      <label>Name</label><input name="name" value="${esc(e.name||'')}" required />
      <label>Job title</label><input name="title" value="${esc(e.title||'')}" />
      ${m?'':`<label>Email</label><input name="email" type="email" required />`}
      <label>${m?'Reset password (optional)':'Password'}</label><input name="password" type="password" ${m?'':'required'} />
      <label>Role</label><select name="role"><option value="employee" ${e.role==='employee'?'selected':''}>Employee</option><option value="org_admin" ${e.role==='org_admin'?'selected':''}>Org admin</option></select>
      ${m?`<label>Status</label><select name="status"><option ${e.status==='active'?'selected':''}>active</option><option ${e.status==='disabled'?'selected':''}>disabled</option></select>`:''}
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">${m?'Save':'Add'}</button></div>
    </form>`);
  const hidden = document.querySelector('#mForm [name=avatar]');
  document.querySelectorAll('#avPick button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#avPick button').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); hidden.value=b.dataset.ic; }));
  document.getElementById('mForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (m && !f.password) delete f.password;
    try { if (m) await api('/members/'+m.id,{method:'PATCH',body:f}); else await api('/members',{method:'POST',body:f}); closeModal(); toast('Saved','success'); routePage(); }
    catch(err){ toast(err.message,'error'); }
  });
}

function awardModal(m) {
  modal(`
    <h2>Award points</h2><p class="muted">Give or deduct stars & points for ${esc(m.name)}.</p>
    <form id="awForm">
      <label>Amount (use negative to deduct)</label><input name="amount" type="number" value="10" required />
      <label>Reason</label><input name="reason" placeholder="Great work on the launch!" />
      <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button type="submit" class="btn">Award</button></div>
    </form>`);
  document.getElementById('awForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('/members/'+m.id+'/award',{method:'POST',body:Object.fromEntries(new FormData(ev.target))}); closeModal(); toast('Points awarded','success'); routePage(); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- LEADERBOARD ---------------- */
async function pageLeaderboard(el) {
  const lb = await api('/leaderboard');
  el.innerHTML = setHead('Leaderboard', 'Top performers across the organization') + `
    <div class="grid cols-3" style="margin-bottom:18px">
      ${lb.slice(0,3).map((u,i) => `<div class="card center" style="background:linear-gradient(135deg,${['#ffd16622','#c0c0c022','#cd7f3222'][i]},var(--panel))">
        <div style="font-size:34px">${['🥇','🥈','🥉'][i]}</div>
        <div class="avatar-sm" style="margin:8px auto;width:54px;height:54px;font-size:28px">${esc(u.avatar)}</div>
        <div class="title-strong">${esc(u.name)}</div><div class="sub">${esc(u.title||'')}</div>
        <div class="stars" style="font-size:18px;margin-top:6px">${u.points} pts</div><div class="sub">Level ${u.level}</div>
      </div>`).join('')}
    </div>
    ${lb.slice(3).map(u => `
      <div class="leader-row"><div class="rank-medal">#${u.rank}</div>
        <div class="avatar-sm">${esc(u.avatar)}</div>
        <div class="grow"><div class="title-strong">${esc(u.name)}</div><div class="sub">${esc(u.title||'')} · Level ${u.level}</div></div>
        <div class="stars">${u.points} pts</div></div>`).join('')}
    ${lb.length===0?emptyState('No employees yet','🏆'):''}`;
}

/* ---------------- EMPLOYEE HOME ---------------- */
async function pageEmployeeHome(el) {
  const [profile, tasks, lb] = await Promise.all([api('/me/profile'), api('/tasks'), api('/leaderboard')]);
  const u = profile.user;
  const myTasks = tasks.filter(t => t.assigned_to === state.user.id && t.status !== 'completed');
  const myRank = lb.find(x => x.id === state.user.id);
  const earned = profile.badges.filter(b => b.earned).length;
  el.innerHTML = setHead('Hi ' + esc(u.name.split(' ')[0]) + ' ' + esc(u.avatar), 'Here is your gamification snapshot') + `
    <div class="grid cols-4">
      ${stat('Stars to spend', u.stars, '⭐', true)}
      ${stat('Total points', u.points, '📈')}
      ${stat('Level', u.level, '🎖️')}
      ${stat('Leaderboard rank', myRank?'#'+myRank.rank:'—', '🏆')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row spread"><h3 style="margin:0">Level ${u.level} progress</h3><span class="sub">${u.intoLevel}/${u.forNext} XP to level ${u.level+1}</span></div>
      <div class="progress" style="margin-top:10px"><span style="width:${u.levelProgress}%"></span></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h3>✅ My active tasks</h3>
        ${myTasks.length ? myTasks.map(t => `<div class="list-item"><div class="grow"><div class="title-strong">${esc(t.title)}</div><div class="sub"><span class="pill ${t.status}">${t.status.replace('_',' ')}</span> ⭐ ${t.points}</div></div>
          ${t.status==='in_progress'?`<button class="btn success sm" data-submit="${t.id}">Done</button>`:''}</div>`).join('') : '<p class="muted">No active tasks. Grab one from the Tasks page!</p>'}
      </div>
      <div class="card">
        <h3>🎖️ Badges (${earned}/${profile.badges.length})</h3>
        <div class="badge-grid">${profile.badges.map(b => `<div class="badge ${b.earned?'':'locked'}"><div class="ic">${b.icon}</div><div class="nm">${b.name}</div><div class="ds">${b.desc}</div></div>`).join('')}</div>
      </div>
    </div>`;
  bindTaskActions(el, false);
}

/* ---------------- PROFILE ---------------- */
async function pageProfile(el) {
  const profile = await api('/me/profile');
  const u = profile.user;
  el.innerHTML = setHead('My Profile', 'Manage your details and review your history') + `
    <div class="grid cols-2">
      <div class="card">
        <h3>Profile</h3>
        <form id="profForm">
          <label>Avatar</label><div class="emoji-pick" id="avPick">${EMOJIS.map(ic => `<button type="button" data-ic="${ic}" class="${u.avatar===ic?'sel':''}">${ic}</button>`).join('')}</div>
          <input type="hidden" name="avatar" value="${u.avatar}" />
          <label>Name</label><input name="name" value="${esc(u.name)}" />
          <label>Job title</label><input name="title" value="${esc(u.title||'')}" />
          <label>New password (optional)</label><input name="password" type="password" />
          <button class="btn" style="margin-top:16px" type="submit">Save changes</button>
        </form>
      </div>
      <div class="card">
        <h3>🎖️ My badges</h3>
        <div class="badge-grid">${profile.badges.map(b => `<div class="badge ${b.earned?'':'locked'}"><div class="ic">${b.icon}</div><div class="nm">${b.name}</div></div>`).join('')}</div>
        <h3 style="margin-top:20px">⚡ Points history</h3>
        ${profile.transactions.length ? profile.transactions.map(t => `<div class="list-item" style="padding:9px"><div class="grow"><div class="sub">${esc(t.reason||t.kind)}</div><div class="sub">${fmtDate(t.created_at)}</div></div><div class="stars">${t.amount>0?'+':''}${t.amount}</div></div>`).join('') : '<p class="muted">No history yet.</p>'}
      </div>
    </div>`;
  const hidden = document.querySelector('#profForm [name=avatar]');
  document.querySelectorAll('#avPick button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#avPick button').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); hidden.value=b.dataset.ic; }));
  document.getElementById('profForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    if (!f.password) delete f.password;
    try { const updated = await api('/me/profile',{method:'PATCH',body:f}); state.user = updated; toast('Profile updated','success'); renderShell(document.getElementById('root')); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- small components ---------------- */
function stat(lbl, val, ic, brand) {
  const numeric = typeof val === 'number' || (/^\d+$/.test(String(val)));
  const valHtml = numeric ? `<div class="val" data-count="${parseInt(val,10)}">0</div>` : `<div class="val">${val}</div>`;
  return `<div class="stat ${brand?'brand':''}"><div class="ic">${ic}</div><div class="lbl">${lbl}</div>${valHtml}</div>`;
}
function emptyState(msg, ic) {
  return `<div class="empty" style="grid-column:1/-1"><div class="ic">${ic}</div><p>${msg}</p></div>`;
}

/* ============================================================
   PROJECT MANAGEMENT (Asana-style) frontend
   ============================================================ */
let pmState = { projectId: null, project: null, tasks: [], view: 'board', people: [] };
let _peopleCache = null;
async function pmPeople() { if (!_peopleCache) _peopleCache = await api('/pm/people'); return _peopleCache; }

const PRIO = { none: ['', 'None'], low: ['low', 'Low'], medium: ['medium', 'Med'], high: ['high', 'High'] };
const STAT_LABEL = { on_track: '🟢 On track', at_risk: '🟡 At risk', off_track: '🔴 Off track', on_hold: '⚪ On hold', complete: '✅ Complete', achieved: '🏆 Achieved', no_status: '⚪ No status' };
const avatarSm = (u, sz = 28) => u ? `<span class="pm-av" title="${esc(u.name)}" style="width:${sz}px;height:${sz}px;font-size:${sz*0.5}px">${esc(u.avatar || '🙂')}</span>` : `<span class="pm-av none" style="width:${sz}px;height:${sz}px">＋</span>`;
function dueChip(d, completed) {
  if (!d) return '';
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !completed && d < today;
  const isToday = d === today;
  return `<span class="due-chip ${overdue ? 'overdue' : isToday ? 'today' : ''}">📅 ${fmtDate(d)}</span>`;
}
const prioPill = (p) => p && p !== 'none' ? `<span class="pill ${PRIO[p][0]}">${PRIO[p][1]}</span>` : '';
function tagChips(tags) { return (tags || []).map(t => `<span class="tag-chip" style="--c:${t.color}">${esc(t.name)}</span>`).join(''); }

/* ---------------- Projects list ---------------- */
async function pageProjects(el) {
  const [projects, teams] = await Promise.all([api('/pm/projects'), api('/pm/teams')]);
  const favs = projects.filter(p => p.favorite);
  const byTeam = {};
  projects.forEach(p => { const k = p.team ? p.team.name : 'No team'; (byTeam[k] = byTeam[k] || []).push(p); });
  el.innerHTML = setHead('Projects', `${projects.length} project${projects.length === 1 ? '' : 's'} across ${teams.length} team${teams.length === 1 ? '' : 's'}`,
    `<button class="btn ghost" id="newTeam">+ Team</button><button class="btn" id="newProject">+ New project</button>`) +
    (favs.length ? `<div class="pm-sec-label">⭐ Favorites</div><div class="grid auto">${favs.map(projectCard).join('')}</div>` : '') +
    Object.entries(byTeam).map(([team, ps]) => `<div class="pm-sec-label">${esc(team)}</div><div class="grid auto">${ps.map(projectCard).join('')}</div>`).join('') +
    (projects.length ? '' : emptyState('No projects yet — create your first one!', '🗂️'));

  el.querySelector('#newProject').addEventListener('click', () => projectModal(teams));
  el.querySelector('#newTeam').addEventListener('click', teamModal);
  el.querySelectorAll('[data-proj]').forEach(c => c.addEventListener('click', () => openProjectView(c.dataset.proj)));
}
function projectCard(p) {
  return `<div class="card proj-card" data-proj="${p.id}" style="--c:${p.color}">
    <div class="row spread"><div class="proj-icon" style="background:${p.color}33">${p.icon}</div>${p.favorite ? '<span class="fav">⭐</span>' : ''}</div>
    <div class="title-strong" style="margin-top:10px">${esc(p.name)}</div>
    <div class="sub" style="margin:4px 0 10px">${esc(p.description || 'No description')}</div>
    <div class="progress"><span style="width:${p.progress}%"></span></div>
    <div class="row spread" style="margin-top:8px"><span class="sub">${p.task_done}/${p.task_total} done</span><span class="pill ${p.status}">${(STAT_LABEL[p.status] || p.status).replace(/^.. /, '')}</span></div>
  </div>`;
}

/* ---------------- Project detail with views ---------------- */
async function openProjectView(id, view) {
  const el = document.getElementById('pageRoot');
  el.innerHTML = `<div class="loader"><span class="spin">⭐</span></div>`;
  try {
    const [project, tasks, people] = await Promise.all([api('/pm/projects/' + id), api('/pm/projects/' + id + '/tasks'), pmPeople()]);
    pmState = { projectId: id, project, tasks, view: view || project.default_view, people };
    renderProjectShell();
  } catch (e) { el.innerHTML = `<div class="empty"><div class="ic">😵</div><p>${esc(e.message)}</p></div>`; }
}
async function reloadProject() {
  const [project, tasks] = await Promise.all([api('/pm/projects/' + pmState.projectId), api('/pm/projects/' + pmState.projectId + '/tasks')]);
  pmState.project = project; pmState.tasks = tasks;
  renderProjectShell();
}
function renderProjectShell() {
  const p = pmState.project;
  const views = [['overview', '📋'], ['board', '🗂️'], ['list', '☰'], ['calendar', '📅'], ['timeline', '📊'], ['dashboard', '📈']];
  document.getElementById('pageRoot').innerHTML = `
    <div class="proj-head">
      <button class="btn ghost sm" id="backProjects">← Projects</button>
      <div class="proj-title"><span class="proj-icon" style="background:${p.color}33">${p.icon}</span>
        <div><h1 style="margin:0;font-size:24px">${esc(p.name)}</h1>
        <div class="sub">${p.team ? p.team.icon + ' ' + esc(p.team.name) + ' · ' : ''}${p.task_done}/${p.task_total} tasks · <span class="pill ${p.status}">${STAT_LABEL[p.status] || p.status}</span></div></div>
        <button class="icon-btn" id="favProj" title="Favorite">${p.favorite ? '⭐' : '☆'}</button>
      </div>
      <div class="row wrap" style="margin-left:auto">
        <div class="pm-people">${p.members.slice(0, 6).map(m => avatarSm(m, 30)).join('')}<button class="icon-btn" id="projMembers" title="Members">＋</button></div>
        <button class="btn ghost sm" id="projSettings">⚙️</button>
        <button class="btn sm" id="addTaskTop">+ Add task</button>
      </div>
    </div>
    <div class="view-tabs">${views.map(([v, ic]) => `<button data-view="${v}" class="${pmState.view === v ? 'active' : ''}">${ic} ${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
    <div id="pmView"></div>`;
  document.getElementById('backProjects').addEventListener('click', () => { state.page = 'projects'; renderShell(document.getElementById('root')); });
  document.getElementById('favProj').addEventListener('click', async () => { await api('/pm/projects/' + p.id + '/favorite', { method: 'POST' }); FX.sound('click'); reloadProject(); });
  document.getElementById('addTaskTop').addEventListener('click', () => quickAddTask(p.sections[0] ? p.sections[0].id : null));
  document.getElementById('projMembers').addEventListener('click', projectMembersModal);
  document.getElementById('projSettings').addEventListener('click', projectSettingsModal);
  document.querySelectorAll('.view-tabs [data-view]').forEach(b => b.addEventListener('click', () => { pmState.view = b.dataset.view; renderProjectShell(); }));
  renderProjectView();
}
function renderProjectView() {
  const v = pmState.view;
  ({ board: viewBoard, list: viewList, calendar: viewCalendar, timeline: viewTimeline, dashboard: viewDashboard, overview: viewOverview }[v] || viewBoard)();
}
const tasksInSection = (sid) => pmState.tasks.filter(t => (t.section_id || null) === (sid || null));

/* ---- Board view ---- */
function viewBoard() {
  const p = pmState.project;
  const cols = [...p.sections];
  const noSection = tasksInSection(null);
  const html = `<div class="board">${cols.map(s => boardCol(s.id, s.name, tasksInSection(s.id))).join('')}
    ${noSection.length ? boardCol(null, 'No section', noSection) : ''}
    <div class="board-add"><button class="btn ghost sm" id="addSection">+ Add section</button></div></div>`;
  document.getElementById('pmView').innerHTML = html;
  document.getElementById('addSection').addEventListener('click', async () => {
    const name = prompt('Section name'); if (!name) return;
    await api('/pm/projects/' + p.id + '/sections', { method: 'POST', body: { name } }); reloadProject();
  });
  bindBoard();
}
function boardCol(sid, name, tasks) {
  return `<div class="board-col" data-sec="${sid || ''}">
    <div class="board-col-head"><span>${esc(name)}</span><span class="cnt">${tasks.length}</span></div>
    <div class="board-cards">${tasks.map(taskCardPM).join('')}</div>
    <button class="board-quick" data-quick="${sid || ''}">＋ Add task</button>
  </div>`;
}
function taskCardPM(t) {
  return `<div class="task-card ${t.completed ? 'done' : ''}" data-task="${t.id}">
    <div class="row" style="align-items:flex-start;gap:8px">
      <button class="check ${t.completed ? 'on' : ''}" data-check="${t.id}">${t.completed ? '✓' : ''}</button>
      <div class="grow">
        ${t.is_milestone ? '<span class="milestone">◆ Milestone</span>' : ''}
        <div class="tname">${esc(t.name)}</div>
        ${t.tags && t.tags.length ? `<div class="tag-row">${tagChips(t.tags)}</div>` : ''}
        <div class="task-meta">${prioPill(t.priority)}${dueChip(t.due_date, t.completed)}
          ${t.counts.subtasks ? `<span class="mini">☑ ${t.counts.subtasks_done}/${t.counts.subtasks}</span>` : ''}
          ${t.counts.comments ? `<span class="mini">💬 ${t.counts.comments}</span>` : ''}
          ${t.counts.deps ? `<span class="mini">🔗 ${t.counts.deps}</span>` : ''}
        </div>
      </div>
      ${avatarSm(t.assignee, 26)}
    </div>
  </div>`;
}
function bindBoard() {
  document.querySelectorAll('[data-task]').forEach(c => c.addEventListener('click', (e) => { if (e.target.closest('[data-check]')) return; openTask(c.dataset.task); }));
  document.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); toggleComplete(b.dataset.check, e); }));
  document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => quickAddTask(b.dataset.quick || null)));
}
async function toggleComplete(id, ev) {
  const t = findTask(id); if (!t) return;
  try {
    const updated = await api('/pm/tasks/' + id, { method: 'PATCH', body: { completed: !t.completed } });
    if (updated.completed) { FX.sound('coin'); if (ev) FX.pop('+' + (updated.points || 0) + '★', ev, '#34e0ff'); FX.confetti(ev ? ev.clientX : innerWidth / 2, ev ? ev.clientY : 200, 36); }
    await refreshUser();
    Object.assign(t, updated);
    reloadProject();
  } catch (e) { toast(e.message, 'error'); }
}
function findTask(id) { return pmState.tasks.find(t => String(t.id) === String(id)); }
async function quickAddTask(sectionId) {
  const name = prompt('Task name'); if (!name) return;
  try { await api('/pm/tasks', { method: 'POST', body: { name, project_id: pmState.projectId, section_id: sectionId } }); FX.sound('whoosh'); reloadProject(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- List view ---- */
function viewList() {
  const p = pmState.project;
  const groups = [...p.sections.map(s => [s.id, s.name]), [null, 'No section']];
  const html = `<div class="list-view">${groups.map(([sid, name]) => {
    const tasks = tasksInSection(sid); if (!tasks.length && sid !== null) return listGroup(sid, name, tasks);
    return tasks.length ? listGroup(sid, name, tasks) : '';
  }).join('')}</div>`;
  document.getElementById('pmView').innerHTML = html || emptyState('No tasks yet', '☰');
  document.querySelectorAll('[data-task]').forEach(r => r.addEventListener('click', (e) => { if (e.target.closest('[data-check]')) return; openTask(r.dataset.task); }));
  document.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); toggleComplete(b.dataset.check, e); }));
  document.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => quickAddTask(b.dataset.quick || null)));
}
function listGroup(sid, name, tasks) {
  return `<div class="list-group"><div class="list-group-head">${esc(name)} <span class="cnt">${tasks.length}</span></div>
    ${tasks.map(t => `<div class="list-row ${t.completed ? 'done' : ''}" data-task="${t.id}">
      <button class="check ${t.completed ? 'on' : ''}" data-check="${t.id}">${t.completed ? '✓' : ''}</button>
      <div class="grow tname">${t.is_milestone ? '◆ ' : ''}${esc(t.name)} ${t.tags && t.tags.length ? tagChips(t.tags) : ''}</div>
      <div class="row" style="gap:8px">${prioPill(t.priority)}${dueChip(t.due_date, t.completed)}${avatarSm(t.assignee, 24)}</div>
    </div>`).join('')}
    <button class="board-quick" data-quick="${sid || ''}">＋ Add task</button></div>`;
}

/* ---- Calendar view ---- */
let calMonth = null;
function viewCalendar() {
  const dated = pmState.tasks.filter(t => t.due_date);
  const base = calMonth || (dated.length ? new Date(dated[0].due_date + 'T00:00:00') : new Date());
  calMonth = new Date(base.getFullYear(), base.getMonth(), 1);
  const year = calMonth.getFullYear(), month = calMonth.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const monthName = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('pmView').innerHTML = `
    <div class="cal-head"><button class="btn ghost sm" id="calPrev">←</button><b>${monthName}</b><button class="btn ghost sm" id="calNext">→</button></div>
    <div class="cal-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
    ${cells.map(d => {
      if (!d) return `<div class="cal-cell empty"></div>`;
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const ts = dated.filter(t => t.due_date === ds);
      return `<div class="cal-cell ${ds === today ? 'today' : ''}"><div class="cal-day">${d}</div>
        ${ts.map(t => `<div class="cal-task ${t.completed ? 'done' : ''}" data-task="${t.id}" style="--c:${pmState.project.color}">${t.is_milestone ? '◆ ' : ''}${esc(t.name)}</div>`).join('')}</div>`;
    }).join('')}</div>`;
  document.getElementById('calPrev').addEventListener('click', () => { calMonth = new Date(year, month - 1, 1); viewCalendar(); });
  document.getElementById('calNext').addEventListener('click', () => { calMonth = new Date(year, month + 1, 1); viewCalendar(); });
  document.querySelectorAll('.cal-task').forEach(c => c.addEventListener('click', () => openTask(c.dataset.task)));
}

/* ---- Timeline view ---- */
function viewTimeline() {
  const ts = pmState.tasks.filter(t => t.due_date || t.start_date).map(t => ({ ...t, s: t.start_date || t.due_date, e: t.due_date || t.start_date }));
  if (!ts.length) { document.getElementById('pmView').innerHTML = emptyState('Add start/due dates to see a timeline', '📊'); return; }
  const dates = ts.flatMap(t => [t.s, t.e]).sort();
  let min = new Date(dates[0] + 'T00:00:00'), max = new Date(dates[dates.length - 1] + 'T00:00:00');
  min.setDate(min.getDate() - 2); max.setDate(max.getDate() + 2);
  const span = Math.max(1, (max - min) / 86400000);
  const pos = (d) => ((new Date(d + 'T00:00:00') - min) / 86400000 / span) * 100;
  document.getElementById('pmView').innerHTML = `<div class="timeline">${ts.map(t => {
    const left = pos(t.s), width = Math.max(3, pos(t.e) - left + 100 / span);
    return `<div class="tl-row" data-task="${t.id}"><div class="tl-label">${t.is_milestone ? '◆ ' : ''}${esc(t.name)}</div>
      <div class="tl-track"><div class="tl-bar ${t.completed ? 'done' : ''}" style="left:${left}%;width:${width}%;background:${pmState.project.color}">
        ${avatarSm(t.assignee, 18)}<span>${fmtDate(t.s)}${t.e !== t.s ? '–' + fmtDate(t.e) : ''}</span></div></div></div>`;
  }).join('')}</div>`;
  document.querySelectorAll('.tl-row').forEach(r => r.addEventListener('click', () => openTask(r.dataset.task)));
}

/* ---- Dashboard view ---- */
function viewDashboard() {
  const ts = pmState.tasks;
  const done = ts.filter(t => t.completed).length;
  const total = ts.length;
  const overdue = ts.filter(t => !t.completed && t.due_date && t.due_date < new Date().toISOString().slice(0, 10)).length;
  const byPrio = ['high', 'medium', 'low', 'none'].map(p => [PRIO[p][1], ts.filter(t => !t.completed && t.priority === p).length]);
  const byAssignee = {};
  ts.forEach(t => { const n = t.assignee ? t.assignee.name : 'Unassigned'; byAssignee[n] = (byAssignee[n] || 0) + 1; });
  const bySection = pmState.project.sections.map(s => [s.name, tasksInSection(s.id).length]);
  document.getElementById('pmView').innerHTML = `
    <div class="grid cols-4">${stat('Total tasks', total, '📋', true)}${stat('Completed', done, '✅')}${stat('Overdue', overdue, '⚠️')}${stat('Completion', (total ? Math.round(done / total * 100) : 0) + '%', '🎯')}</div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>By priority</h3>${barChart(byPrio)}</div>
      <div class="card"><h3>By assignee</h3>${barChart(Object.entries(byAssignee))}</div>
      <div class="card"><h3>By section</h3>${barChart(bySection)}</div>
      <div class="card"><h3>Progress</h3><div class="donut" style="--p:${total ? Math.round(done / total * 100) : 0}"><span>${total ? Math.round(done / total * 100) : 0}%</span></div></div>
    </div>`;
  FX.animateCounts(document.getElementById('pmView'));
}
function barChart(pairs) {
  const max = Math.max(1, ...pairs.map(p => p[1]));
  return `<div class="bars">${pairs.map(([k, v]) => `<div class="bar-row"><span class="bar-lbl">${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div><span class="bar-val">${v}</span></div>`).join('') || '<p class="muted">No data</p>'}</div>`;
}

/* ---- Overview view ---- */
function viewOverview() {
  const p = pmState.project;
  document.getElementById('pmView').innerHTML = `<div class="grid cols-2">
    <div class="card"><h3>About</h3><p class="muted">${esc(p.description || 'No description yet.')}</p>
      <div class="ov-stats"><div><b>${p.task_total}</b><span>Tasks</span></div><div><b>${p.task_done}</b><span>Done</span></div><div><b>${p.progress}%</b><span>Progress</span></div><div><b>${p.members.length}</b><span>Members</span></div></div>
      <h3 style="margin-top:18px">Team</h3><div class="row wrap">${p.members.map(m => `<div class="chip-person">${avatarSm(m, 24)} ${esc(m.name)}</div>`).join('')}</div>
    </div>
    <div class="card"><div class="row spread"><h3 style="margin:0">Status updates</h3><button class="btn sm" id="postStatus">+ Update</button></div>
      ${p.status_updates.length ? p.status_updates.map(s => `<div class="status-update"><div class="row spread"><span class="pill ${s.status}">${STAT_LABEL[s.status] || s.status}</span><span class="sub">${fmtDate(s.created_at)}</span></div>
        ${s.title ? `<div class="title-strong" style="margin-top:6px">${esc(s.title)}</div>` : ''}<div class="sub">${esc(s.body || '')}</div><div class="sub">— ${esc(s.author || '')}</div></div>`).join('') : '<p class="muted">No status updates yet.</p>'}
    </div></div>`;
  document.getElementById('postStatus').addEventListener('click', postStatusModal);
}

/* ---------------- Task drawer ---------------- */
async function openTask(id) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="drawer-bg" id="dbg"><div class="drawer"><div class="loader"><span class="spin">⭐</span></div></div></div>`;
  document.getElementById('dbg').addEventListener('click', e => { if (e.target.id === 'dbg') closeDrawer(); });
  try { const t = await api('/pm/tasks/' + id); renderDrawer(t); } catch (e) { toast(e.message, 'error'); closeDrawer(); }
}
function closeDrawer() { document.getElementById('modal-root').innerHTML = ''; if (pmState.projectId) reloadProject(); }
window.closeDrawer = closeDrawer;

function renderDrawer(t) {
  const people = pmState.people || [];
  const sections = pmState.project ? pmState.project.sections : [];
  const cfields = t.custom_fields || [];
  const cvals = Object.fromEntries((t.custom_values || []).map(v => [v.field_id, v.value]));
  document.getElementById('modal-root').querySelector('.drawer').innerHTML = `
    <div class="drawer-head">
      <button class="btn success sm ${t.completed ? '' : 'ghost'}" id="dComplete">${t.completed ? '✓ Completed' : 'Mark complete'}</button>
      <div class="row" style="gap:6px">
        <button class="icon-btn" id="dLike" title="Like">${t.liked ? '❤️' : '🤍'} ${t.counts.likes || ''}</button>
        <button class="icon-btn" id="dFollow" title="Follow">${'👁️'}</button>
        <button class="icon-btn" id="dDelete" title="Delete">🗑️</button>
        <button class="icon-btn" id="dClose">✕</button>
      </div>
    </div>
    <input class="d-title" id="dName" value="${esc(t.name)}" />
    ${t.project ? `<div class="sub" style="margin:-4px 0 14px">in <b style="color:${t.project.color}">${t.project.icon} ${esc(t.project.name)}</b></div>` : ''}
    <div class="d-grid">
      <label>Assignee</label><select id="dAssignee"><option value="">Unassigned</option>${people.map(u => `<option value="${u.id}" ${t.assignee_id == u.id ? 'selected' : ''}>${esc(u.avatar)} ${esc(u.name)}</option>`).join('')}</select>
      <label>Due date</label><input type="date" id="dDue" value="${t.due_date || ''}" />
      <label>Start date</label><input type="date" id="dStart" value="${t.start_date || ''}" />
      <label>Priority</label><select id="dPriority">${Object.keys(PRIO).map(p => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${PRIO[p][1]}</option>`).join('')}</select>
      ${sections.length ? `<label>Section</label><select id="dSection"><option value="">None</option>${sections.map(s => `<option value="${s.id}" ${t.section_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
      <label>Recurrence</label><select id="dRecur">${['none', 'daily', 'weekly', 'monthly'].map(r => `<option value="${r}" ${t.recurrence === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <label>Milestone</label><div><button class="btn ghost sm" id="dMilestone">${t.is_milestone ? '◆ Yes' : '◇ No'}</button></div>
      ${cfields.map(f => `<label>${esc(f.name)}</label>${f.type === 'dropdown'
        ? `<select data-cf="${f.id}"><option value="">—</option>${f.options.map(o => `<option ${cvals[f.id] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input data-cf="${f.id}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(cvals[f.id] || '')}" />`}`).join('')}
    </div>
    <div class="d-tags">${tagChips(t.tags)}<button class="tag-add" id="dAddTag">+ Tag</button></div>
    <label>Description</label><textarea id="dNotes" placeholder="Add details…">${esc(t.notes || '')}</textarea>

    <div class="d-section"><div class="row spread"><b>Subtasks ${t.subtasks.length ? `(${t.subtasks.filter(s => s.completed).length}/${t.subtasks.length})` : ''}</b></div>
      <div id="dSubs">${t.subtasks.map(s => `<div class="sub-row"><button class="check sm ${s.completed ? 'on' : ''}" data-subcheck="${s.id}">${s.completed ? '✓' : ''}</button><span class="${s.completed ? 'done' : ''}">${esc(s.name)}</span>${avatarSm(s.assignee, 20)}</div>`).join('')}</div>
      <div class="row" style="margin-top:6px"><input id="dSubInput" placeholder="Add subtask…" /><button class="btn sm" id="dAddSub">Add</button></div>
    </div>

    <div class="d-section"><b>Dependencies</b>
      <div id="dDeps">${t.dependencies.map(d => `<div class="sub-row">🔗 Blocked by <span class="${d.completed ? 'done' : ''}">${esc(d.name)}</span><button class="icon-btn sm" data-undep="${d.id}">✕</button></div>`).join('') || '<span class="sub">No dependencies</span>'}</div>
      <button class="btn ghost sm" id="dAddDep" style="margin-top:6px">+ Add dependency</button>
    </div>

    <div class="d-section"><b>Attachments</b>
      <div id="dAtt">${t.attachments.map(a => `<div class="sub-row">📎 ${a.url ? `<a href="${esc(a.url)}" target="_blank">${esc(a.name)}</a>` : esc(a.name)}<button class="icon-btn sm" data-unatt="${a.id}">✕</button></div>`).join('') || '<span class="sub">None</span>'}</div>
      <button class="btn ghost sm" id="dAddAtt" style="margin-top:6px">+ Add link</button>
    </div>

    <div class="d-section"><b>Collaborators</b>
      <div class="row wrap" style="margin-top:6px">${t.followers.map(f => avatarSm(f, 26)).join('')}<button class="btn ghost sm" id="dAddFollow">+ Add</button></div>
    </div>

    <div class="d-section"><b>Comments</b>
      <div id="dComments">${t.comments.map(commentHtml).join('') || '<span class="sub">No comments yet</span>'}</div>
      <div class="row" style="margin-top:8px"><input id="dCommentInput" placeholder="Write a comment… use @name to mention" /><button class="btn sm" id="dSendComment">Send</button></div>
    </div>

    <div class="d-section"><b>Activity</b>
      <div class="activity">${t.activity.map(a => `<div class="act-row"><span class="act-dot"></span><span class="sub"><b>${esc(a.author || 'Someone')}</b> ${esc(actText(a))} · ${fmtDate(a.created_at)}</span></div>`).join('') || '<span class="sub">No activity</span>'}</div>
    </div>`;
  bindDrawer(t);
}
function actText(a) { return ({ created: 'created this task', completed: 'completed this task', reopened: 'reopened this task', assigned: 'changed assignee', comment: 'commented', subtask: 'added a subtask', dependency: 'added a dependency', attachment: 'added an attachment', rule: a.detail || 'automation ran' }[a.type] || a.type); }
function commentHtml(c) {
  return `<div class="comment"><div class="pm-av" style="width:30px;height:30px">${esc(c.avatar || '🙂')}</div>
    <div class="grow"><div class="row spread"><b>${esc(c.author || 'Someone')}</b><span class="sub">${fmtDate(c.created_at)}</span></div>
    <div>${esc(c.body)}</div><button class="like-comment ${c.liked ? 'on' : ''}" data-likec="${c.id}">${c.liked ? '❤️' : '🤍'} ${c.likes || ''}</button></div></div>`;
}
function bindDrawer(t) {
  const id = t.id;
  const patch = async (body, fx) => { try { await api('/pm/tasks/' + id, { method: 'PATCH', body }); if (fx) fx(); } catch (e) { toast(e.message, 'error'); } };
  const $ = (s) => document.getElementById(s);
  $('dClose').addEventListener('click', closeDrawer);
  $('dName').addEventListener('change', e => patch({ name: e.target.value }));
  $('dNotes').addEventListener('change', e => patch({ notes: e.target.value }));
  $('dAssignee').addEventListener('change', e => patch({ assignee_id: e.target.value || null }));
  $('dDue').addEventListener('change', e => patch({ due_date: e.target.value || null }));
  $('dStart').addEventListener('change', e => patch({ start_date: e.target.value || null }));
  $('dPriority').addEventListener('change', e => patch({ priority: e.target.value }));
  $('dRecur').addEventListener('change', e => patch({ recurrence: e.target.value }));
  const sec = $('dSection'); if (sec) sec.addEventListener('change', e => patch({ section_id: e.target.value || null }));
  $('dMilestone').addEventListener('click', async () => { await patch({ is_milestone: !t.is_milestone }); openTask(id); });
  $('dComplete').addEventListener('click', async (e) => {
    try { const u = await api('/pm/tasks/' + id, { method: 'PATCH', body: { completed: !t.completed } });
      if (u.completed) { FX.sound('coin'); FX.confetti(e.clientX, e.clientY, 40); FX.pop('+' + (u.points || 0) + '★', e, '#34e0ff'); await refreshUser(); }
      openTask(id);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('dLike').addEventListener('click', async () => { await api('/pm/like', { method: 'POST', body: { target_type: 'task', target_id: id } }); FX.sound('coin'); openTask(id); });
  $('dFollow').addEventListener('click', async () => { await api('/pm/tasks/' + id + '/follow', { method: 'POST' }); toast('Updated collaborators'); openTask(id); });
  $('dDelete').addEventListener('click', async () => { if (!confirm('Delete this task?')) return; await api('/pm/tasks/' + id, { method: 'DELETE' }); closeDrawer(); });
  // custom fields
  document.querySelectorAll('[data-cf]').forEach(el => el.addEventListener('change', e => api('/pm/tasks/' + id + '/fields', { method: 'PATCH', body: { field_id: el.dataset.cf, value: e.target.value } })));
  // subtasks
  $('dAddSub').addEventListener('click', async () => { const v = $('dSubInput').value.trim(); if (!v) return; await api('/pm/tasks/' + id + '/subtasks', { method: 'POST', body: { name: v } }); FX.sound('click'); openTask(id); });
  document.querySelectorAll('[data-subcheck]').forEach(b => b.addEventListener('click', async (e) => { const st = t.subtasks.find(s => s.id == b.dataset.subcheck); await api('/pm/tasks/' + b.dataset.subcheck, { method: 'PATCH', body: { completed: !st.completed } }); if (!st.completed) FX.sound('coin'); openTask(id); }));
  // dependencies
  $('dAddDep').addEventListener('click', () => depModal(id));
  document.querySelectorAll('[data-undep]').forEach(b => b.addEventListener('click', async () => { await api('/pm/tasks/' + id + '/dependencies/' + b.dataset.undep, { method: 'DELETE' }); openTask(id); }));
  // attachments
  $('dAddAtt').addEventListener('click', async () => { const name = prompt('Attachment name'); if (!name) return; const url = prompt('Link URL (optional)') || ''; await api('/pm/tasks/' + id + '/attachments', { method: 'POST', body: { name, url } }); openTask(id); });
  document.querySelectorAll('[data-unatt]').forEach(b => b.addEventListener('click', async () => { await api('/pm/attachments/' + b.dataset.unatt, { method: 'DELETE' }); openTask(id); }));
  // followers add
  $('dAddFollow').addEventListener('click', () => followModal(id));
  // tags
  $('dAddTag').addEventListener('click', () => tagPickModal(id));
  // comments
  $('dSendComment').addEventListener('click', async () => { const v = $('dCommentInput').value.trim(); if (!v) return; await api('/pm/tasks/' + id + '/comments', { method: 'POST', body: { body: v } }); FX.sound('whoosh'); openTask(id); });
  $('dCommentInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('dSendComment').click(); });
  document.querySelectorAll('[data-likec]').forEach(b => b.addEventListener('click', async () => { await api('/pm/like', { method: 'POST', body: { target_type: 'comment', target_id: b.dataset.likec } }); FX.sound('coin'); openTask(id); }));
}
function depModal(taskId) {
  const opts = pmState.tasks.filter(t => t.id != taskId).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  modal(`<h2>Add dependency</h2><p class="muted">This task will be blocked until the selected task is complete.</p>
    <label>Blocked by</label><select id="depSel">${opts}</select>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn" id="depSave">Add</button></div>`);
  document.getElementById('depSave').addEventListener('click', async () => { await api('/pm/tasks/' + taskId + '/dependencies', { method: 'POST', body: { blocked_by: document.getElementById('depSel').value } }); closeModal(); openTask(taskId); });
}
function followModal(taskId) {
  modal(`<h2>Add collaborator</h2><label>Person</label><select id="folSel">${pmState.people.map(u => `<option value="${u.id}">${esc(u.avatar)} ${esc(u.name)}</option>`).join('')}</select>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn" id="folSave">Add</button></div>`);
  document.getElementById('folSave').addEventListener('click', async () => { await api('/pm/tasks/' + taskId + '/follow', { method: 'POST', body: { user_id: Number(document.getElementById('folSel').value) } }); closeModal(); openTask(taskId); });
}
async function tagPickModal(taskId) {
  const tags = await api('/pm/tags');
  modal(`<h2>Add a tag</h2>
    <div class="row wrap" style="margin:10px 0">${tags.map(g => `<button class="tag-chip pick" data-tag="${g.id}" style="--c:${g.color}">${esc(g.name)}</button>`).join('') || '<span class="sub">No tags yet</span>'}</div>
    <div class="row"><input id="newTagName" placeholder="New tag name" /><button class="btn sm" id="newTagBtn">Create</button></div>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  document.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', async () => { await api('/pm/tasks/' + taskId + '/tags', { method: 'POST', body: { tag_id: b.dataset.tag } }); closeModal(); openTask(taskId); }));
  document.getElementById('newTagBtn').addEventListener('click', async () => { const n = document.getElementById('newTagName').value.trim(); if (!n) return; const g = await api('/pm/tags', { method: 'POST', body: { name: n } }); await api('/pm/tasks/' + taskId + '/tags', { method: 'POST', body: { tag_id: g.id } }); closeModal(); openTask(taskId); });
}

/* ---------------- Project modals ---------------- */
function teamModal() {
  modal(`<h2>New team</h2><form id="teamForm"><label>Name</label><input name="name" required /><label>Icon (emoji)</label><input name="icon" value="👥" /><label>Description</label><textarea name="description"></textarea>
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Create</button></div></form>`);
  document.getElementById('teamForm').addEventListener('submit', async e => { e.preventDefault(); try { await api('/pm/teams', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Team created', 'success'); routePage(); } catch (err) { toast(err.message, 'error'); } });
}
function projectModal(teams) {
  const colors = ['#7c9bff', '#34e0ff', '#2ce6a8', '#ffd23f', '#ff5fa2', '#b56bff', '#ffab2e', '#ff5d73'];
  modal(`<h2>New project</h2><form id="projForm">
    <label>Name</label><input name="name" required placeholder="e.g. Website Revamp" />
    <label>Icon</label><div class="emoji-pick" id="pIcon">${['📁', '🚀', '📣', '🎧', '🎨', '💼', '🛠️', '📊', '🧪', '🎯'].map(i => `<button type="button" data-i="${i}" class="${i === '📁' ? 'sel' : ''}">${i}</button>`).join('')}</div><input type="hidden" name="icon" value="📁" />
    <label>Color</label><div class="color-pick" id="pColor">${colors.map((c, i) => `<button type="button" data-c="${c}" class="${i === 0 ? 'sel' : ''}" style="background:${c}"></button>`).join('')}</div><input type="hidden" name="color" value="#7c9bff" />
    <label>Team</label><select name="team_id"><option value="">No team</option>${teams.map(t => `<option value="${t.id}">${t.icon} ${esc(t.name)}</option>`).join('')}</select>
    <label>Start from template</label><select name="template"><option value="blank">Blank (To do / Doing / Done)</option><option value="kanban">Kanban board</option><option value="sprint">Sprint planning</option><option value="editorial">Editorial calendar</option></select>
    <label>Default view</label><select name="default_view"><option value="board">Board</option><option value="list">List</option><option value="calendar">Calendar</option><option value="timeline">Timeline</option></select>
    <label>Description</label><textarea name="description"></textarea>
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Create project</button></div></form>`);
  document.querySelectorAll('#pIcon button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#pIcon button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); document.querySelector('[name=icon]').value = b.dataset.i; }));
  document.querySelectorAll('#pColor button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#pColor button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); document.querySelector('[name=color]').value = b.dataset.c; }));
  document.getElementById('projForm').addEventListener('submit', async e => { e.preventDefault(); try { const p = await api('/pm/projects', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); FX.confetti(innerWidth / 2, 200, 60); toast('Project created!', 'success'); openProjectView(p.id); } catch (err) { toast(err.message, 'error'); } });
}
async function projectMembersModal() {
  const p = pmState.project;
  modal(`<h2>Project members</h2>
    <div id="memList">${p.members.map(m => `<div class="row spread member-row">${avatarSm(m, 28)} <span class="grow">${esc(m.name)}</span><button class="icon-btn sm" data-rm="${m.id}">✕</button></div>`).join('')}</div>
    <label>Add member</label><div class="row"><select id="addMemSel">${pmState.people.filter(u => !p.members.find(m => m.id === u.id)).map(u => `<option value="${u.id}">${esc(u.avatar)} ${esc(u.name)}</option>`).join('')}</select><button class="btn sm" id="addMemBtn">Add</button></div>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Done</button></div>`);
  document.getElementById('addMemBtn').addEventListener('click', async () => { const uid = document.getElementById('addMemSel').value; if (!uid) return; await api('/pm/projects/' + p.id + '/members', { method: 'POST', body: { user_id: Number(uid) } }); closeModal(); reloadProject(); });
  document.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => { await api('/pm/projects/' + p.id + '/members/' + b.dataset.rm, { method: 'DELETE' }); closeModal(); reloadProject(); }));
}
function postStatusModal() {
  const p = pmState.project;
  modal(`<h2>Post status update</h2><form id="stForm"><label>Status</label><select name="status">${['on_track', 'at_risk', 'off_track', 'on_hold', 'complete'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${STAT_LABEL[s]}</option>`).join('')}</select>
    <label>Headline</label><input name="title" placeholder="e.g. Ahead of schedule" /><label>Details</label><textarea name="body"></textarea>
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Post</button></div></form>`);
  document.getElementById('stForm').addEventListener('submit', async e => { e.preventDefault(); await api('/pm/projects/' + p.id + '/status', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Status posted', 'success'); reloadProject(); });
}
async function projectSettingsModal() {
  const p = pmState.project;
  modal(`<h2>⚙️ Project settings</h2>
    <div class="tabs" id="setTabs"><button data-t="general" class="active">General</button><button data-t="fields">Custom fields</button><button data-t="rules">Rules</button><button data-t="form">Form</button></div>
    <div id="setBody"></div>`);
  const tabs = { general: setGeneral, fields: setFields, rules: setRules, form: setForm };
  const show = (t) => { document.querySelectorAll('#setTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === t)); tabs[t](); };
  document.querySelectorAll('#setTabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.t)));
  show('general');

  function setGeneral() {
    document.getElementById('setBody').innerHTML = `<form id="genForm"><label>Name</label><input name="name" value="${esc(p.name)}" />
      <label>Description</label><textarea name="description">${esc(p.description || '')}</textarea>
      <label>Privacy</label><select name="privacy"><option value="team" ${p.privacy === 'team' ? 'selected' : ''}>Team</option><option value="public" ${p.privacy === 'public' ? 'selected' : ''}>Public to org</option><option value="private" ${p.privacy === 'private' ? 'selected' : ''}>Private</option></select>
      <div class="actions"><button type="button" class="btn danger" id="delProj">Delete project</button><button class="btn">Save</button></div></form>`;
    document.getElementById('genForm').addEventListener('submit', async e => { e.preventDefault(); await api('/pm/projects/' + p.id, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); reloadProject(); toast('Saved', 'success'); });
    document.getElementById('delProj').addEventListener('click', async () => { if (!confirm('Delete this project and all its tasks?')) return; await api('/pm/projects/' + p.id, { method: 'DELETE' }); closeModal(); state.page = 'projects'; renderShell(document.getElementById('root')); });
  }
  function setFields() {
    document.getElementById('setBody').innerHTML = `<div id="cfList">${p.custom_fields.map(f => `<div class="row spread member-row"><span class="grow"><b>${esc(f.name)}</b> <span class="sub">${f.type}</span></span><button class="icon-btn sm" data-delf="${f.id}">✕</button></div>`).join('') || '<p class="muted">No custom fields</p>'}</div>
      <form id="cfForm"><label>Field name</label><input name="name" required /><label>Type</label><select name="type"><option value="text">Text</option><option value="number">Number</option><option value="dropdown">Dropdown</option></select>
      <label>Options (dropdown, comma-separated)</label><input name="opts" placeholder="Low, Medium, High" />
      <div class="actions"><button class="btn">Add field</button></div></form>`;
    document.getElementById('cfForm').addEventListener('submit', async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await api('/pm/projects/' + p.id + '/fields', { method: 'POST', body: { name: f.name, type: f.type, options: f.opts ? f.opts.split(',').map(s => s.trim()) : [] } }); const np = await api('/pm/projects/' + p.id); p.custom_fields = np.custom_fields; setFields(); });
    document.querySelectorAll('[data-delf]').forEach(b => b.addEventListener('click', async () => { await api('/pm/fields/' + b.dataset.delf, { method: 'DELETE' }); p.custom_fields = p.custom_fields.filter(f => f.id != b.dataset.delf); setFields(); }));
  }
  function setRules() {
    document.getElementById('setBody').innerHTML = `<div id="ruleList">${p.rules.map(r => `<div class="row spread member-row"><span class="grow"><b>${esc(r.name)}</b><br><span class="sub">When ${r.trigger_type.replace('_', ' ')} → ${r.action_type.replace('_', ' ')}</span></span><button class="icon-btn sm" data-delr="${r.id}">✕</button></div>`).join('') || '<p class="muted">No automation rules</p>'}</div>
      <form id="ruleForm"><label>Rule name</label><input name="name" required placeholder="Auto-assign new tasks" />
      <label>When (trigger)</label><select name="trigger_type"><option value="task_added">Task added</option><option value="completed">Task completed</option><option value="assignee_set">Assignee set</option><option value="moved_section">Moved to section</option></select>
      <label>Do (action)</label><select name="action_type" id="ruleAction"><option value="set_assignee">Set assignee</option><option value="set_priority">Set priority</option><option value="move_section">Move to section</option><option value="add_comment">Add comment</option><option value="add_follower">Add collaborator</option></select>
      <label>Value</label><input name="action_value" placeholder="user id / priority / section id / text" />
      <div class="actions"><button class="btn">Add rule</button></div></form>`;
    document.getElementById('ruleForm').addEventListener('submit', async e => { e.preventDefault(); await api('/pm/projects/' + p.id + '/rules', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); const np = await api('/pm/projects/' + p.id); p.rules = np.rules; setRules(); toast('Rule added', 'success'); });
    document.querySelectorAll('[data-delr]').forEach(b => b.addEventListener('click', async () => { await api('/pm/rules/' + b.dataset.delr, { method: 'DELETE' }); p.rules = p.rules.filter(r => r.id != b.dataset.delr); setRules(); }));
  }
  function setForm() {
    const f = p.form;
    document.getElementById('setBody').innerHTML = `<p class="muted">Let teammates submit requests that become tasks in this project.</p>
      <form id="formForm"><label><input type="checkbox" name="enabled" ${f.enabled ? 'checked' : ''} style="width:auto"> Enable intake form</label>
      <label>Form title</label><input name="title" value="${esc(f.title)}" />
      <label>Questions (comma-separated)</label><input name="fields" value="${esc((f.fields || []).join(', '))}" placeholder="Steps to reproduce, Severity" />
      <div class="actions"><button class="btn">Save form</button></div></form>
      ${f.enabled ? `<button class="btn ghost" id="openForm" style="width:100%;margin-top:10px">↗ Preview / submit the form</button>` : ''}`;
    document.getElementById('formForm').addEventListener('submit', async e => { e.preventDefault(); const fd = new FormData(e.target); await api('/pm/projects/' + p.id + '/form', { method: 'PATCH', body: { enabled: fd.get('enabled') === 'on', title: fd.get('title'), fields: (fd.get('fields') || '').split(',').map(s => s.trim()).filter(Boolean) } }); const np = await api('/pm/projects/' + p.id); p.form = np.form; closeModal(); toast('Form saved', 'success'); });
    const of = document.getElementById('openForm'); if (of) of.addEventListener('click', () => { closeModal(); intakeFormModal(p); });
  }
}
function intakeFormModal(p) {
  modal(`<h2>${esc(p.form.title)}</h2><form id="intakeForm"><label>Title</label><input name="name" required />
    ${(p.form.fields || []).map(q => `<label>${esc(q)}</label><input data-q="${esc(q)}" />`).join('')}
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Submit</button></div></form>`);
  document.getElementById('intakeForm').addEventListener('submit', async e => { e.preventDefault(); const answers = {}; document.querySelectorAll('[data-q]').forEach(i => answers[i.dataset.q] = i.value); await api('/pm/projects/' + p.id + '/submit', { method: 'POST', body: { name: e.target.name.value, answers } }); closeModal(); FX.confetti(innerWidth / 2, 200, 50); toast('Submitted! 🎉', 'success'); if (pmState.projectId == p.id) reloadProject(); });
}

/* ---------------- My Tasks ---------------- */
async function pageMyTasks(el) {
  const [tasks] = await Promise.all([api('/pm/my-tasks'), pmPeople()]);
  const today = new Date().toISOString().slice(0, 10);
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const open = tasks.filter(t => !t.completed);
  const buckets = {
    '🔴 Overdue': open.filter(t => t.due_date && t.due_date < today),
    '⭐ Today': open.filter(t => t.due_date === today),
    '📆 Next 7 days': open.filter(t => t.due_date && t.due_date > today && t.due_date <= next7),
    '🗓️ Later': open.filter(t => t.due_date && t.due_date > next7),
    '📥 No due date': open.filter(t => !t.due_date),
    '✅ Completed': tasks.filter(t => t.completed),
  };
  el.innerHTML = setHead('My Tasks', `${open.length} open · ${tasks.length} total assigned to you`) +
    Object.entries(buckets).map(([name, ts]) => ts.length ? `<div class="pm-sec-label">${name} <span class="cnt">${ts.length}</span></div>
      <div class="mytasks">${ts.map(myRow).join('')}</div>` : '').join('') +
    (tasks.length ? '' : emptyState('No tasks assigned to you yet', '🌟'));
  el.querySelectorAll('[data-task]').forEach(r => r.addEventListener('click', e => { if (e.target.closest('[data-check]')) return; openTaskStandalone(r.dataset.task); }));
  el.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async (e) => { e.stopPropagation(); const t = tasks.find(x => x.id == b.dataset.check); const u = await api('/pm/tasks/' + b.dataset.check, { method: 'PATCH', body: { completed: !t.completed } }); if (u.completed) { FX.sound('coin'); FX.confetti(e.clientX, e.clientY, 36); FX.pop('+' + (u.points || 0) + '★', e, '#34e0ff'); await refreshUser(); } pageMyTasks(el); }));
}
function myRow(t) {
  return `<div class="list-row ${t.completed ? 'done' : ''}" data-task="${t.id}">
    <button class="check ${t.completed ? 'on' : ''}" data-check="${t.id}">${t.completed ? '✓' : ''}</button>
    <div class="grow tname">${t.is_milestone ? '◆ ' : ''}${esc(t.name)} ${tagChips(t.tags)}</div>
    <div class="row" style="gap:8px">${t.project_name ? `<span class="proj-pill" style="--c:${t.project_color}">${t.project_icon} ${esc(t.project_name)}</span>` : ''}${prioPill(t.priority)}${dueChip(t.due_date, t.completed)}</div>
  </div>`;
}
// open a task drawer that refreshes the current standalone page instead of a project
async function openTaskStandalone(id) {
  await pmPeople();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="drawer-bg" id="dbg"><div class="drawer"><div class="loader"><span class="spin">⭐</span></div></div></div>`;
  document.getElementById('dbg').addEventListener('click', e => { if (e.target.id === 'dbg') { document.getElementById('modal-root').innerHTML = ''; routePage(); } });
  try { const t = await api('/pm/tasks/' + id); pmState.people = await pmPeople(); pmState.project = t.project ? { ...pmState.project, sections: [], custom_fields: t.custom_fields, color: t.project.color } : pmState.project; renderDrawerStandalone(t); }
  catch (e) { toast(e.message, 'error'); document.getElementById('modal-root').innerHTML = ''; }
}
function renderDrawerStandalone(t) {
  const prevClose = window.closeDrawer;
  renderDrawer(t);
  // override close to refresh the standalone list rather than a project
  window.closeDrawer = () => { document.getElementById('modal-root').innerHTML = ''; window.closeDrawer = prevClose; routePage(); };
  const c = document.getElementById('dClose'); if (c) { c.replaceWith(c.cloneNode(true)); document.getElementById('dClose').addEventListener('click', window.closeDrawer); }
}

/* ---------------- Inbox ---------------- */
const NOTIF_IC = { assigned: '📌', mention: '💬', comment: '🗨️', completed: '✅', due_soon: '⏰', follow: '👁️', status: '📣' };
async function pageInbox(el) {
  const notifs = await api('/pm/inbox');
  el.innerHTML = setHead('Inbox', `${notifs.filter(n => !n.is_read).length} unread notification${notifs.filter(n => !n.is_read).length === 1 ? '' : 's'}`,
    `<button class="btn ghost" id="readAll">Mark all read</button>`) +
    (notifs.length ? `<div class="inbox">${notifs.map(n => `<div class="inbox-row ${n.is_read ? '' : 'unread'}" data-n="${n.id}" data-task="${n.task_id || ''}">
      <span class="inbox-ic">${NOTIF_IC[n.type] || '🔔'}</span>
      <div class="grow"><div>${avatarSmInline(n.actor_avatar, n.actor_name)} <b>${esc(n.actor_name || 'Someone')}</b> ${esc(n.text)}</div>
      <div class="sub">${n.project_name ? esc(n.project_name) + ' · ' : ''}${fmtDate(n.created_at)}</div></div>
      ${n.is_read ? '' : '<span class="unread-dot"></span>'}</div>`).join('')}</div>` : emptyState('You\'re all caught up! 🎉', '📥'));
  el.querySelector('#readAll').addEventListener('click', async () => { await api('/pm/inbox/read-all', { method: 'POST' }); refreshInboxBadge(); pageInbox(el); });
  el.querySelectorAll('[data-n]').forEach(r => r.addEventListener('click', async () => {
    await api('/pm/inbox/' + r.dataset.n + '/read', { method: 'POST' }); refreshInboxBadge();
    if (r.dataset.task) openTaskStandalone(r.dataset.task); else pageInbox(el);
  }));
}
const avatarSmInline = (av, name) => `<span class="pm-av" style="width:22px;height:22px;font-size:12px;vertical-align:middle">${esc(av || '🙂')}</span>`;

/* ---------------- Goals ---------------- */
async function pageGoals(el) {
  const [goals] = await Promise.all([api('/pm/goals'), pmPeople()]);
  el.innerHTML = setHead('Goals', 'Track objectives and key results across the company', `<button class="btn" id="newGoal">+ New goal</button>`) +
    `<div class="grid auto">${goals.map(goalCard).join('') || emptyState('Set your first goal 🎯', '🎯')}</div>`;
  el.querySelector('#newGoal').addEventListener('click', () => goalModal());
  el.querySelectorAll('[data-goal]').forEach(c => c.addEventListener('click', e => { if (e.target.closest('button')) return; goalModal(goals.find(g => g.id == c.dataset.goal)); }));
  el.querySelectorAll('[data-delgoal]').forEach(b => b.addEventListener('click', async (e) => { e.stopPropagation(); if (!confirm('Delete goal?')) return; await api('/pm/goals/' + b.dataset.delgoal, { method: 'DELETE' }); pageGoals(el); }));
}
function goalCard(g) {
  return `<div class="card goal-card" data-goal="${g.id}">
    <div class="row spread"><span class="pill ${g.status}">${STAT_LABEL[g.status] || g.status}</span><button class="icon-btn sm" data-delgoal="${g.id}">✕</button></div>
    <div class="title-strong" style="margin:8px 0">${esc(g.name)}</div>
    <div class="donut sm" style="--p:${g.progress}"><span>${g.progress}%</span></div>
    <div class="row spread" style="margin-top:10px"><span class="sub">${avatarSmInline(g.owner_avatar)} ${esc(g.owner_name || '')}</span><span class="sub">${g.linked} project${g.linked === 1 ? '' : 's'}${g.due_date ? ' · ' + fmtDate(g.due_date) : ''}</span></div>
  </div>`;
}
function goalModal(g) {
  const e = g || {};
  modal(`<h2>${g ? 'Edit goal' : 'New goal'}</h2><form id="goalForm">
    <label>Goal name</label><input name="name" value="${esc(e.name || '')}" required />
    <label>Description</label><textarea name="description">${esc(e.description || '')}</textarea>
    <div class="row"><div class="grow"><label>Status</label><select name="status">${['on_track', 'at_risk', 'off_track', 'achieved', 'no_status'].map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${STAT_LABEL[s]}</option>`).join('')}</select></div>
    <div class="grow"><label>Progress %</label><input name="progress" type="number" min="0" max="100" value="${e.progress || 0}" /></div></div>
    <label>Owner</label><select name="owner_id">${(pmState.people || []).map(u => `<option value="${u.id}" ${e.owner_id == u.id ? 'selected' : ''}>${esc(u.avatar)} ${esc(u.name)}</option>`).join('')}</select>
    <label>Due date</label><input name="due_date" type="date" value="${e.due_date || ''}" />
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">${g ? 'Save' : 'Create'}</button></div></form>`);
  document.getElementById('goalForm').addEventListener('submit', async ev => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); try { if (g) await api('/pm/goals/' + g.id, { method: 'PATCH', body: f }); else await api('/pm/goals', { method: 'POST', body: f }); closeModal(); toast('Saved', 'success'); routePage(); } catch (err) { toast(err.message, 'error'); } });
}

/* ---------------- Portfolios ---------------- */
async function pagePortfolios(el) {
  const portfolios = await api('/pm/portfolios');
  el.innerHTML = setHead('Portfolios', 'Group projects and track roll-up progress', `<button class="btn" id="newPf">+ New portfolio</button>`) +
    `<div class="grid auto">${portfolios.map(pf => `<div class="card pf-card" data-pf="${pf.id}" style="--c:${pf.color}">
      <div class="proj-icon" style="background:${pf.color}33">🗃️</div>
      <div class="title-strong" style="margin-top:10px">${esc(pf.name)}</div><div class="sub">${esc(pf.description || '')}</div>
      <div class="progress" style="margin-top:10px"><span style="width:${pf.progress}%"></span></div>
      <div class="row spread" style="margin-top:8px"><span class="sub">${pf.project_count} project${pf.project_count === 1 ? '' : 's'}</span><span class="sub">${pf.progress}% complete</span></div>
    </div>`).join('') || emptyState('Create a portfolio to roll up projects 🗃️', '🗃️')}</div>`;
  el.querySelector('#newPf').addEventListener('click', portfolioModal);
  el.querySelectorAll('[data-pf]').forEach(c => c.addEventListener('click', () => openPortfolio(c.dataset.pf)));
}
function portfolioModal() {
  modal(`<h2>New portfolio</h2><form id="pfForm"><label>Name</label><input name="name" required /><label>Description</label><textarea name="description"></textarea>
    <div class="actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Create</button></div></form>`);
  document.getElementById('pfForm').addEventListener('submit', async e => { e.preventDefault(); await api('/pm/portfolios', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Portfolio created', 'success'); routePage(); });
}
async function openPortfolio(id) {
  const [pf, projects] = await Promise.all([api('/pm/portfolios/' + id), api('/pm/projects')]);
  const el = document.getElementById('pageRoot');
  el.innerHTML = `<div class="page-head"><div><button class="btn ghost sm" id="backPf">← Portfolios</button><h1 style="margin:8px 0 0">${esc(pf.name)}</h1><p>${pf.projects.length} projects · ${pf.description || ''}</p></div><button class="btn" id="addPfProj">+ Add project</button></div>
    <table><thead><tr><th>Project</th><th>Progress</th><th>Tasks</th><th>Status</th><th></th></tr></thead><tbody>
    ${pf.projects.map(p => `<tr data-open="${p.id}"><td><b>${p.icon} ${esc(p.name)}</b></td><td><div class="progress" style="width:120px"><span style="width:${p.progress}%"></span></div></td><td>${p.task_done}/${p.task_total}</td><td><span class="pill ${p.status}">${STAT_LABEL[p.status] || p.status}</span></td><td><button class="icon-btn sm" data-rmproj="${p.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted center" style="padding:24px">No projects yet</td></tr>'}
    </tbody></table>`;
  el.querySelector('#backPf').addEventListener('click', () => routePage());
  el.querySelectorAll('[data-open]').forEach(r => r.addEventListener('click', e => { if (e.target.closest('[data-rmproj]')) return; openProjectView(r.dataset.open); }));
  el.querySelectorAll('[data-rmproj]').forEach(b => b.addEventListener('click', async () => { await api('/pm/portfolios/' + id + '/projects/' + b.dataset.rmproj, { method: 'DELETE' }); openPortfolio(id); }));
  el.querySelector('#addPfProj').addEventListener('click', () => {
    const avail = projects.filter(p => !pf.projects.find(x => x.id === p.id));
    modal(`<h2>Add project</h2><label>Project</label><select id="pfProjSel">${avail.map(p => `<option value="${p.id}">${p.icon} ${esc(p.name)}</option>`).join('')}</select><div class="actions"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn" id="pfAddBtn">Add</button></div>`);
    document.getElementById('pfAddBtn').addEventListener('click', async () => { await api('/pm/portfolios/' + id + '/projects', { method: 'POST', body: { project_id: Number(document.getElementById('pfProjSel').value) } }); closeModal(); openPortfolio(id); });
  });
}

/* ---------------- Reporting + Workload ---------------- */
let reportTab = 'overview';
async function pageReporting(el) {
  el.innerHTML = setHead('Reporting', 'Insights across all projects') + `<div class="tabs" id="repTabs"><button data-t="overview" class="${reportTab === 'overview' ? 'active' : ''}">📈 Overview</button><button data-t="workload" class="${reportTab === 'workload' ? 'active' : ''}">⚖️ Workload</button></div><div id="repBody"><div class="loader"><span class="spin">⭐</span></div></div>`;
  el.querySelectorAll('#repTabs button').forEach(b => b.addEventListener('click', () => { reportTab = b.dataset.t; pageReporting(el); }));
  if (reportTab === 'overview') {
    const r = await api('/pm/reporting');
    document.getElementById('repBody').innerHTML = `
      <div class="grid cols-4">${stat('Projects', r.projects, '🗂️', true)}${stat('Tasks', r.totalTasks, '📋')}${stat('Completed', r.completed, '✅')}${stat('Overdue', r.overdue, '⚠️')}</div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="card"><h3>Completion rate</h3><div class="donut" style="--p:${r.completionRate}"><span>${r.completionRate}%</span></div></div>
        <div class="card"><h3>Open tasks by priority</h3>${barChart(r.byPriority.map(p => [PRIO[p.priority][1], p.c]))}</div>
        <div class="card"><h3>Tasks by project</h3>${barChart(r.byProject.map(p => [p.name, p.total]))}</div>
        <div class="card"><h3>Tasks by assignee</h3>${barChart(r.byAssignee.map(a => [a.name, a.total]))}</div>
        <div class="card" style="grid-column:1/-1"><h3>Completed in last 7 days</h3>${barChart(last7(r.trend))}</div>
      </div>`;
    FX.animateCounts(document.getElementById('repBody'));
  } else {
    const w = await api('/pm/workload');
    document.getElementById('repBody').innerHTML = `<div class="card"><h3>Team workload (open tasks)</h3>
      ${w.map(m => `<div class="wl-row"><div class="row" style="gap:10px;min-width:180px">${avatarSm(m, 30)}<b>${esc(m.name)}</b></div>
        <div class="bar-track grow"><div class="bar-fill ${m.capacity > 90 ? 'hot' : ''}" style="width:${m.capacity}%"></div></div>
        <span class="sub" style="min-width:160px;text-align:right">${m.open} open · ${m.overdue} overdue · ${m.done} done</span></div>`).join('')}</div>`;
  }
}
function last7(trend) {
  const map = Object.fromEntries(trend.map(t => [t.d, t.c]));
  const out = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); out.push([new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }), map[d] || 0]); }
  return out;
}

/* ---------------- Global search ---------------- */
function searchModal() {
  modal(`<h2>🔍 Search</h2><input id="searchInput" placeholder="Search tasks and projects…" autofocus /><div id="searchResults" style="margin-top:14px"></div>
    <div class="actions"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  const input = document.getElementById('searchInput');
  let tmr;
  input.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { document.getElementById('searchResults').innerHTML = '<p class="muted">Type at least 2 characters…</p>'; return; }
      const r = await api('/pm/search?q=' + encodeURIComponent(q));
      document.getElementById('searchResults').innerHTML =
        (r.projects.length ? `<div class="pm-sec-label">Projects</div>${r.projects.map(p => `<div class="search-row" data-proj="${p.id}"><span class="proj-icon sm" style="background:${p.color}33">${p.icon}</span> ${esc(p.name)}</div>`).join('')}` : '') +
        (r.tasks.length ? `<div class="pm-sec-label">Tasks</div>${r.tasks.map(t => `<div class="search-row ${t.completed ? 'done' : ''}" data-stask="${t.id}">${t.completed ? '✅' : '⬜'} ${esc(t.name)} ${t.project_name ? `<span class="proj-pill" style="--c:${t.project_color}">${esc(t.project_name)}</span>` : ''}</div>`).join('')}` : '') +
        (!r.projects.length && !r.tasks.length ? '<p class="muted">No matches</p>' : '');
      document.querySelectorAll('[data-proj]').forEach(c => c.addEventListener('click', () => { closeModal(); state.page = 'projects'; renderShell(document.getElementById('root')); setTimeout(() => openProjectView(c.dataset.proj), 50); }));
      document.querySelectorAll('[data-stask]').forEach(c => c.addEventListener('click', () => { closeModal(); openTaskStandalone(c.dataset.stask); }));
    }, 220);
  });
}

boot();
