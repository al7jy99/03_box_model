/* Headless smoke test for the SPA: loads app.js in jsdom with stubs,
   walks login -> each role -> every page, asserting no runtime errors. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');

// ---- fake API data keyed by "METHOD path" (path without query) ----
function makeUser(role, over = {}) {
  return { id: 1, org_id: role === 'super_admin' ? null : 1, email: 'x@y.com', name: 'Test User',
    role, title: 't', avatar: '🙂', points: 120, stars: 60, status: 'active', level: 2,
    levelProgress: 40, intoLevel: 80, forNext: 200, ...over };
}
let CURRENT_ROLE = 'employee';
function fakeData(method, p) {
  const u = makeUser(CURRENT_ROLE);
  const org = { id: 1, name: 'Acme', slug: 'acme', plan: 'pro', status: 'active', seats: 50 };
  const map = {
    'POST /auth/login': { token: 'tok', user: u, org },
    'POST /auth/signup': { token: 'tok', user: u, org },
    'GET /auth/me': { user: u, org },
    'GET /super/stats': { orgs: 2, activeOrgs: 2, users: 8, tasks: 5, ideas: 3, redemptions: 1, pointsAwarded: 400 },
    'GET /super/orgs': [{ ...org, members: 5, tasks: 5, ideas: 3, admin_email: 'a@b.com' }],
    'GET /analytics': { members: 5, tasksOpen: 3, tasksDone: 2, pendingReview: 1, ideasPending: 1, ideasTotal: 3,
      challenges: 2, pendingRedemptions: 1, starsInCirculation: 300, pointsAwarded: 400,
      topMembers: [{ name: 'A', avatar: '🙂', points: 100 }], recent: [{ amount: 10, kind: 'task', reason: 'r', created_at: '2026-01-01 00:00:00', user_name: 'A' }] },
    'GET /members': [makeUser('employee', { id: 2, name: 'Emp' })],
    'GET /tasks': [{ id: 1, org_id: 1, title: 'T', description: 'd', points: 10, assigned_to: null, status: 'open', priority: 'medium', assignee_name: null, assignee_avatar: null },
                   { id: 2, org_id: 1, title: 'T2', points: 20, assigned_to: 1, status: 'in_progress', priority: 'high', assignee_name: 'Test', assignee_avatar: '🙂' },
                   { id: 3, org_id: 1, title: 'T3', points: 30, assigned_to: 1, status: 'submitted', priority: 'low', assignee_name: 'Test', assignee_avatar: '🙂' }],
    'GET /challenges': [{ id: 1, org_id: 1, title: 'C', description: 'd', points: 50, goal: 10, unit: 'steps', status: 'active', participants: 2, finishers: 1, me: null },
                        { id: 2, org_id: 1, title: 'C2', description: 'd', points: 50, goal: 5, unit: 'reps', status: 'active', participants: 1, finishers: 0, me: { progress: 2, completed: 0 } }],
    'GET /ideas': [{ id: 1, org_id: 1, user_id: 1, title: 'I', description: 'd', category: 'general', status: 'pending', author: 'A', author_avatar: '🙂', votes: 3, voted: 0 }],
    'GET /rewards': [{ id: 1, org_id: 1, title: 'Pizza', description: 'd', cost: 50, icon: '🍕', stock: -1, active: 1 }],
    'GET /redemptions': [{ id: 1, org_id: 1, user_id: 1, reward_title: 'Pizza', cost: 50, status: 'pending', created_at: '2026-01-01 00:00:00', user_name: 'A', user_avatar: '🙂' }],
    'GET /leaderboard': [{ rank: 1, id: 1, name: 'A', avatar: '🙂', title: 't', points: 100, stars: 50, level: 2 },
                         { rank: 2, id: 2, name: 'B', avatar: '😎', title: 't', points: 80, stars: 40, level: 1 },
                         { rank: 3, id: 3, name: 'C', avatar: '🦊', title: 't', points: 60, stars: 30, level: 1 },
                         { rank: 4, id: 4, name: 'D', avatar: '🐼', title: 't', points: 40, stars: 20, level: 1 }],
    'GET /me/profile': { user: u, badges: [{ id: 'rookie', icon: '🌱', name: 'Rookie', desc: 'd', earned: true }, { id: 'x', icon: '🏅', name: 'X', desc: 'd', earned: false }],
      transactions: [{ amount: 10, kind: 'task', reason: 'r', created_at: '2026-01-01 00:00:00' }] },
    // ---- project management ----
    'GET /pm/inbox/count': { unread: 2 },
    'GET /pm/people': [{ id: 1, name: 'Me', avatar: '🙂', title: 't' }, { id: 2, name: 'Other', avatar: '😎', title: 't' }],
    'GET /pm/teams': [{ id: 1, name: 'Eng', icon: '⚙️', members: 3, projects: 2, joined: 1 }],
    'GET /pm/projects': [{ id: 1, name: 'Website', description: 'd', color: '#7c9bff', icon: '🚀', status: 'on_track', progress: 50, task_total: 4, task_done: 2, members: 3, favorite: true, team: { name: 'Eng', icon: '⚙️' } }],
    'GET /pm/my-tasks': [{ id: 1, name: 'Do thing', completed: 0, due_date: '2026-06-19', priority: 'high', is_milestone: 0, tags: [], project_name: 'Website', project_color: '#7c9bff', project_icon: '🚀', assignee: u, counts: {} }],
    'GET /pm/inbox': [{ id: 1, type: 'mention', text: 'mentioned you', is_read: 0, actor_name: 'A', actor_avatar: '🙂', task_id: 1, project_name: 'Website', created_at: '2026-01-01 00:00:00' }],
    'GET /pm/goals': [{ id: 1, name: 'Grow', status: 'on_track', progress: 60, owner_name: 'A', owner_avatar: '🙂', linked: 2, due_date: '2026-09-01' }],
    'GET /pm/portfolios': [{ id: 1, name: 'OKRs', description: 'd', color: '#34e0ff', progress: 45, project_count: 3 }],
    'GET /pm/workload': [{ id: 1, name: 'A', avatar: '🙂', open: 5, overdue: 1, done: 3, capacity: 62 }],
    'GET /pm/projects/1': { id: 1, name: 'Website', description: 'd', color: '#7c9bff', icon: '🚀', status: 'on_track', progress: 50, task_total: 4, task_done: 2, favorite: true, can_edit: true,
      team: { name: 'Eng', icon: '⚙️' }, owner: { id: 1, name: 'Me', avatar: '🙂' },
      members: [{ id: 1, name: 'Me', avatar: '🙂', title: 't', role: 'employee', access: 'editor' }, { id: 2, name: 'Guest', avatar: '🧑', role: 'guest', access: 'commenter' }],
      sections: [{ id: 10, name: 'To Do', position: 0 }, { id: 11, name: 'Doing', position: 1 }],
      custom_fields: [{ id: 5, name: 'Platforms', type: 'multi_select', options: ['iOS', 'Web'] }, { id: 6, name: 'Reviewer', type: 'people', options: [] }, { id: 7, name: 'Launch', type: 'date', options: [] }],
      rules: [], status_updates: [{ id: 1, status: 'on_track', title: 'Good', body: 'b', author: 'Me', created_at: '2026-01-01 00:00:00' }],
      form: { enabled: false, title: 'Submit', fields: [] } },
    'GET /pm/projects/1/tasks': [
      { id: 1, name: 'Design', section_id: 10, completed: 0, priority: 'high', due_date: '2026-06-20', start_date: '2026-06-18', is_milestone: 0, task_type: 'task', multihomed_here: false, tags: [{ id: 1, name: 'design', color: '#b56bff' }], assignee: { id: 1, name: 'Me', avatar: '🙂' }, counts: { subtasks: 2, subtasks_done: 1, comments: 1, deps: 0, likes: 0, followers: 1, attachments: 0 }, blocked_by: [] },
      { id: 2, name: 'Build', section_id: 11, completed: 0, priority: 'medium', due_date: '2026-06-25', start_date: '2026-06-21', is_milestone: 0, task_type: 'approval', approval_status: 'pending', multihomed_here: true, tags: [], assignee: null, counts: { subtasks: 0, comments: 0, deps: 1 }, blocked_by: [1] },
    ],
    'GET /pm/tags': [{ id: 1, name: 'design', color: '#b56bff', uses: 3 }],
    'GET /pm/tasks/1': { id: 1, name: 'Design', notes: 'n', section_id: 10, project_id: 1, assignee_id: 1, completed: 0, priority: 'high', is_milestone: 0,
      task_type: 'task', approval_status: '', recurrence: 'weekly', recur_interval: 2, recur_weekdays: '1,3', due_date: '2026-06-20', start_date: '2026-06-18',
      project: { id: 1, name: 'Website', color: '#7c9bff', icon: '🚀' }, assignee: { id: 1, name: 'Me', avatar: '🙂' }, creator: { id: 1, name: 'Me', avatar: '🙂' },
      tags: [{ id: 1, name: 'design', color: '#b56bff' }], counts: { likes: 1, subtasks: 1 }, liked: false,
      subtasks: [{ id: 9, name: 'Sub', completed: 0, assignee: null }],
      followers: [{ id: 1, name: 'Me', avatar: '🙂' }], dependencies: [], attachments: [{ id: 1, name: 'shot.png', kind: 'file', mime: 'image/png', size: 1024 }],
      comments: [{ id: 1, author: 'Me', avatar: '🙂', body: 'hi @guest', created_at: '2026-01-01 00:00:00', likes: 0, liked: false }],
      activity: [{ type: 'created', author: 'Me', avatar: '🙂', created_at: '2026-01-01 00:00:00' }],
      custom_values: [{ field_id: 5, value: 'iOS' }],
      custom_fields: [{ id: 5, name: 'Platforms', type: 'multi_select', options: ['iOS', 'Web'] }, { id: 6, name: 'Reviewer', type: 'people', options: [] }, { id: 7, name: 'Launch', type: 'date', options: [] }],
      homes: [{ id: 1, name: 'Website', color: '#7c9bff', icon: '🚀', section_id: 10, is_primary: true }] },
    'GET /pm/reporting': { totalTasks: 10, completed: 6, overdue: 2, projects: 3, completionRate: 60,
      byPriority: [{ priority: 'high', c: 2 }, { priority: 'medium', c: 3 }, { priority: 'low', c: 1 }, { priority: 'none', c: 1 }],
      byProject: [{ name: 'Website', color: '#7c9bff', total: 4, done: 2 }],
      byAssignee: [{ name: 'A', avatar: '🙂', total: 5, done: 3 }],
      trend: [{ d: '2026-06-18', c: 2 }, { d: '2026-06-19', c: 1 }] },
  };
  return map[`${method} ${p}`] ?? {};
}

const errors = [];
const dom = new JSDOM(`<!DOCTYPE html><body><div id="root"></div><div id="modal-root"></div><div class="toast-wrap" id="toasts"></div></body>`, {
  url: 'http://localhost/app', runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
global.window = window; global.document = window.document;
window.localStorage = { _d: {}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; }, removeItem(k){ delete this._d[k]; } };
window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};
window.performance = { now: () => Date.now() };
window.AudioContext = class { constructor(){ this.currentTime=0; this.destination={}; } createOscillator(){ return { type:'', frequency:{ setValueAtTime(){} }, connect(){}, start(){}, stop(){} }; } createGain(){ return { gain:{ setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; } };
window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){}, save(){}, translate(){}, rotate(){}, beginPath(){}, arc(){}, fill(){}, fillRect(){}, restore(){}, set fillStyle(v){}, set globalAlpha(v){} });
window.confirm = () => true;
window.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET');
  const p = url.replace(/^.*\/api/, '').split('?')[0];
  return { ok: true, json: async () => fakeData(method, p) };
};
global.fetch = window.fetch;
window.onerror = (m) => errors.push(m);

// Indirect eval runs in Node's global scope, so app.js's bare browser globals
// (window, document, localStorage, fetch, innerWidth, ...) must live on `global`.
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.fetch = window.fetch;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.performance = { now: () => Date.now() };
global.AudioContext = window.AudioContext;
global.confirm = window.confirm;
global.FormData = window.FormData;
global.location = window.location;
global.innerWidth = 1280;
global.innerHeight = 800;

async function main() {
  // Eval app.js once, capturing internal references so the driver can reuse
  // the same module scope (strict-mode eval does not leak bindings).
  const combined = appJs + '\n;window.__T = { state, boot, renderShell, FX, get pmState(){return pmState;}, openProjectView, openTask, renderProjectView, viewBoard, viewList, viewCalendar, viewTimeline, viewDashboard, viewOverview };';
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(combined);
  } catch (e) { errors.push('LOAD: ' + e.message); }
  if (errors.length) { console.log('LOAD ERRORS:\n' + errors.join('\n')); }
  const T = window.__T;
  if (!T) { console.log('window.__T not set — eval aborted early'); process.exit(1); }

  await tick();
  assert(document.querySelector('.auth-card'), 'auth screen renders');

  const pm = ['projects', 'mywork', 'inbox', 'goals', 'portfolios', 'reporting'];
  const roles = {
    super_admin: ['overview', 'orgs'],
    org_admin: ['dashboard', 'tasks', 'challenges', 'ideas', 'rewards', 'redemptions', 'members', 'leaderboard', ...pm],
    employee: ['home', 'tasks', 'challenges', 'ideas', 'shop', 'leaderboard', 'profile', ...pm],
  };

  for (const role of Object.keys(roles)) {
    CURRENT_ROLE = role;
    window.localStorage.setItem('sb_token', 'tok');
    T.state.token = 'tok';
    T.state.page = null;
    await T.boot();
    for (let i = 0; i < 6; i++) await tick();   // let boot's default render settle
    for (const page of roles[role]) {
      T.state.page = page;
      T.renderShell(document.getElementById('root'));
      for (let i = 0; i < 4; i++) await tick();
      const pr = document.getElementById('pageRoot');
      const okPage = pr && pr.innerHTML.length > 50 && !/😵|Loading…/.test(pr.innerHTML);
      if (!okPage && process.env.DEBUG) console.log(`--- ${role}/${page} ---\n` + (pr ? pr.innerHTML.slice(0, 300) : 'NO pageRoot'));
      assert(okPage, `${role}/${page} renders`);
    }
  }
  // exercise FX functions directly
  try { T.FX.confetti(10,10,5); T.FX.sound('levelup'); T.FX.floatText('+5',10,10); T.FX.celebrate('🎉','Hi','sub'); T.FX.animateCounts(document.body); }
  catch (e) { errors.push('FX: ' + e.message); }

  // exercise the project detail (all 6 views) + task drawer (org_admin context)
  CURRENT_ROLE = 'org_admin'; T.state.user = makeUser('org_admin'); T.state.token = 'tok';
  try {
    await T.openProjectView(1);
    for (let i = 0; i < 4; i++) await tick();
    assert(document.querySelector('.proj-head'), 'project detail shell renders');
    for (const v of ['board', 'list', 'calendar', 'timeline', 'dashboard', 'overview']) {
      T.pmState.view = v; T.renderProjectView();
      for (let i = 0; i < 2; i++) await tick();
      const pv = document.getElementById('pmView');
      assert(pv && pv.innerHTML.length > 20, `project view "${v}" renders`);
    }
    // open a task drawer — exercises approval/recurrence/custom fields/homes/attachments markup
    await T.openTask(1);
    for (let i = 0; i < 4; i++) await tick();
    const drawer = document.querySelector('.drawer');
    assert(drawer && drawer.querySelector('#dName'), 'task drawer renders');
    assert(drawer.querySelector('.recur-builder'), 'recurrence builder renders');
    assert(drawer.querySelector('.multi-pick'), 'multi-select custom field renders');
    assert(drawer.querySelector('[data-proof]'), 'image attachment proof button renders');
  } catch (e) { errors.push('PROJECT/DRAWER: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')); }

  if (errors.length) { console.log('FAILURES:\n' + errors.join('\n')); process.exit(1); }
  console.log('ALL UI SMOKE TESTS PASSED ✅');
  process.exit(0);
}
function tick(){ return new Promise(r => setTimeout(r, 5)); }
let passed = 0;
function assert(cond, label){ if (cond) { passed++; } else { errors.push('ASSERT FAILED: ' + label); } }
main().catch(e => { console.log('FATAL', e); process.exit(1); });
