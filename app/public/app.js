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
    ['tasks', '✅', 'Tasks'],
    ['challenges', '🔥', 'Challenges'],
    ['ideas', '💡', 'Ideas'],
    ['rewards', '🎁', 'Rewards'],
    ['redemptions', '🛍️', 'Redemptions'],
    ['members', '👥', 'Members'],
    ['leaderboard', '🏆', 'Leaderboard'],
  ];
  return [
    ['home', '🏠', 'Home'],
    ['tasks', '✅', 'My Tasks'],
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
      ${items.map(([id, ic, label]) => `
        <button class="nav-item ${state.page === id ? 'active' : ''}" data-page="${id}">
          <span class="ic">${ic}</span> ${label}
          ${id === 'redemptions' && pendingBadges.redemptions ? `<span class="badge-count">${pendingBadges.redemptions}</span>` : ''}
          ${id === 'tasks' && role === 'org_admin' && pendingBadges.review ? `<span class="badge-count">${pendingBadges.review}</span>` : ''}
        </button>`).join('')}
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
  const menuBtn = root.querySelector('#menuBtn');
  if (menuBtn) menuBtn.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  routePage();
}

function setHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row wrap">${actions}</div></div>`;
}

async function routePage() {
  const el = document.getElementById('pageRoot');
  el.innerHTML = `<div class="empty"><div class="ic">⏳</div><p>Loading…</p></div>`;
  try {
    const role = state.user.role;
    const p = state.page;
    if (role === 'super_admin') {
      if (p === 'overview') return await pageSuperOverview(el);
      if (p === 'orgs') return await pageSuperOrgs(el);
    } else if (role === 'org_admin') {
      if (p === 'dashboard') return await pageAdminDashboard(el);
      if (p === 'tasks') return await pageTasks(el, true);
      if (p === 'challenges') return await pageChallenges(el, true);
      if (p === 'ideas') return await pageIdeas(el, true);
      if (p === 'rewards') return await pageRewardsAdmin(el);
      if (p === 'redemptions') return await pageRedemptions(el, true);
      if (p === 'members') return await pageMembers(el);
      if (p === 'leaderboard') return await pageLeaderboard(el);
    } else {
      if (p === 'home') return await pageEmployeeHome(el);
      if (p === 'tasks') return await pageTasks(el, false);
      if (p === 'challenges') return await pageChallenges(el, false);
      if (p === 'ideas') return await pageIdeas(el, false);
      if (p === 'shop') return await pageShop(el);
      if (p === 'leaderboard') return await pageLeaderboard(el);
      if (p === 'profile') return await pageProfile(el);
    }
  } catch (err) {
    el.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>${esc(err.message)}</p></div>`;
  }
}

async function refreshUser() {
  try { const me = await api('/auth/me'); state.user = me.user; state.org = me.org; } catch {}
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
  const act = async (id, path, msg) => { try { await api(`/tasks/${id}/${path}`, { method: 'POST' }); toast(msg, 'success'); await refreshUser(); renderShell(document.getElementById('root')); } catch (e) { toast(e.message, 'error'); } };
  el.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => act(b.dataset.claim, 'claim', 'Task claimed!')));
  el.querySelectorAll('[data-submit]').forEach(b => b.addEventListener('click', () => act(b.dataset.submit, 'submit', 'Submitted for review')));
  el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => act(b.dataset.approve, 'approve', 'Approved & points awarded!')));
  el.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => act(b.dataset.reject, 'reject', 'Sent back')));
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
    el.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', async () => { await api('/challenges/'+b.dataset.join+'/join',{method:'POST'}); toast('Joined challenge!','success'); routePage(); }));
    el.querySelectorAll('[data-prog]').forEach(b => b.addEventListener('click', async () => {
      try { const r = await api('/challenges/'+b.dataset.prog+'/progress',{method:'POST',body:{amount:1}});
        toast(r.completed ? '🎉 Challenge complete! Points awarded' : 'Progress logged','success');
        await refreshUser(); renderShell(document.getElementById('root'));
      } catch(e){ toast(e.message,'error'); }
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
  el.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', async () => {
    try { const r = await api('/ideas/'+b.dataset.vote+'/vote',{method:'POST'}); toast(r.voted?'Upvoted':'Vote removed'); routePage(); } catch(e){ toast(e.message,'error'); }
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
    try { await api('/ideas',{method:'POST',body:Object.fromEntries(new FormData(ev.target))}); closeModal(); toast('Idea submitted! +5 stars','success'); await refreshUser(); renderShell(document.getElementById('root')); }
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
    try { const r = await api('/rewards/'+b.dataset.redeem+'/redeem',{method:'POST'}); state.user = r.user; toast('🎉 Redeemed! Pending fulfilment','success'); renderShell(document.getElementById('root')); }
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
  return `<div class="stat ${brand?'brand':''}"><div class="ic">${ic}</div><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
}
function emptyState(msg, ic) {
  return `<div class="empty" style="grid-column:1/-1"><div class="ic">${ic}</div><p>${msg}</p></div>`;
}

boot();
