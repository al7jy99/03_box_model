'use strict';

// ============================================================
// Project management (Asana-style) API — mounted under /api/pm
// ============================================================
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, verifyToken, award, publicUser } = require('./lib');

const ok = (res, data) => res.json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---- file uploads (attachments) ----
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOAD_DIR, String(req.user.org_id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname).slice(0, 12)),
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// ---- auth middleware (self-contained, mirrors server.js) ----
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || user.status === 'disabled') return res.status(401).json({ error: 'Account unavailable' });
  if (user.role === 'super_admin') return res.status(403).json({ error: 'Use an organization account for work management' });
  if (user.org_id) {
    const org = db.prepare('SELECT status FROM organizations WHERE id = ?').get(user.org_id);
    if (org && org.status === 'suspended') return res.status(403).json({ error: 'Organization suspended' });
  }
  req.user = user;
  next();
}
const isAdmin = (req) => req.user.role === 'org_admin';

// ---- helpers ----
const PRIORITY_POINTS = { none: 8, low: 6, medium: 12, high: 20 };

function logActivity(taskId, userId, type, detail = '') {
  db.prepare('INSERT INTO pm_activity (task_id, user_id, type, detail) VALUES (?,?,?,?)').run(taskId, userId, type, detail);
}

function notify({ org_id, user_id, actor_id, type, task_id = null, project_id = null, text = '' }) {
  if (!user_id || user_id === actor_id) return;
  db.prepare(
    'INSERT INTO notifications (org_id, user_id, actor_id, type, task_id, project_id, text) VALUES (?,?,?,?,?,?,?)'
  ).run(org_id, user_id, actor_id, type, task_id, project_id, text);
}

function followersOf(taskId) {
  return db.prepare('SELECT user_id FROM task_followers WHERE task_id = ?').all(taskId).map((r) => r.user_id);
}
function addFollower(taskId, userId) {
  if (userId) db.prepare('INSERT OR IGNORE INTO task_followers (task_id, user_id) VALUES (?,?)').run(taskId, userId);
}

function canAccessProject(user, project) {
  if (!project || project.org_id !== user.org_id) return false;
  if (user.role === 'org_admin') return true;
  if (project.privacy !== 'private') return true;
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(project.id, user.id);
}

function enrichTask(t, userId) {
  const a = t.assignee_id ? db.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(t.assignee_id) : null;
  const tags = db.prepare('SELECT g.id,g.name,g.color FROM task_tags tt JOIN tags g ON g.id=tt.tag_id WHERE tt.task_id=?').all(t.id);
  const sub = db.prepare("SELECT COUNT(*) c, SUM(completed) d FROM pm_tasks WHERE parent_id=?").get(t.id);
  const counts = {
    subtasks: sub.c || 0, subtasks_done: sub.d || 0,
    comments: db.prepare('SELECT COUNT(*) c FROM pm_comments WHERE task_id=?').get(t.id).c,
    likes: db.prepare("SELECT COUNT(*) c FROM pm_likes WHERE target_type='task' AND target_id=?").get(t.id).c,
    followers: db.prepare('SELECT COUNT(*) c FROM task_followers WHERE task_id=?').get(t.id).c,
    attachments: db.prepare('SELECT COUNT(*) c FROM attachments WHERE task_id=?').get(t.id).c,
    deps: db.prepare('SELECT COUNT(*) c FROM task_dependencies WHERE task_id=?').get(t.id).c,
  };
  const liked = userId ? !!db.prepare("SELECT 1 FROM pm_likes WHERE target_type='task' AND target_id=? AND user_id=?").get(t.id, userId) : false;
  return { ...t, assignee: a, tags, counts, liked };
}

// rules engine — run when a trigger fires on a task
function runRules(project_id, trigger, task, actor) {
  const rules = db.prepare('SELECT * FROM rules WHERE project_id=? AND enabled=1 AND trigger_type=?').all(project_id, trigger);
  for (const r of rules) {
    if (trigger === 'moved_section' && r.trigger_value && String(task.section_id) !== String(r.trigger_value)) continue;
    switch (r.action_type) {
      case 'set_assignee':
        db.prepare('UPDATE pm_tasks SET assignee_id=? WHERE id=?').run(Number(r.action_value) || null, task.id);
        addFollower(task.id, Number(r.action_value));
        logActivity(task.id, actor, 'rule', `Rule "${r.name}" set assignee`); break;
      case 'move_section':
        db.prepare('UPDATE pm_tasks SET section_id=? WHERE id=?').run(Number(r.action_value) || null, task.id);
        logActivity(task.id, actor, 'rule', `Rule "${r.name}" moved task`); break;
      case 'set_priority':
        db.prepare('UPDATE pm_tasks SET priority=? WHERE id=?').run(r.action_value || 'none', task.id);
        logActivity(task.id, actor, 'rule', `Rule "${r.name}" set priority`); break;
      case 'add_comment':
        db.prepare('INSERT INTO pm_comments (task_id, user_id, body) VALUES (?,?,?)').run(task.id, actor, r.action_value || '🤖 Automated note');
        logActivity(task.id, actor, 'rule', `Rule "${r.name}" commented`); break;
      case 'add_follower':
        addFollower(task.id, Number(r.action_value)); break;
    }
  }
}

function shiftDate(dateStr, recurrence) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (recurrence === 'daily') d.setDate(d.getDate() + 1);
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// award gamification points the first time a task is completed
function maybeAward(task, actor) {
  if (task.completed && !task.awarded && task.assignee_id) {
    award(task.assignee_id, task.points || 10, 'task', `Completed: ${task.name}`);
    db.prepare('UPDATE pm_tasks SET awarded=1 WHERE id=?').run(task.id);
  }
}

function getTaskScoped(req, id) {
  const t = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(id);
  if (!t || t.org_id !== req.user.org_id) return null;
  return t;
}

// All projects a task lives in: its primary home plus any multi-homed memberships.
function taskHomes(t) {
  const homes = [];
  if (t.project_id) {
    const p = db.prepare('SELECT id,name,color,icon FROM projects WHERE id=?').get(t.project_id);
    if (p) homes.push({ ...p, section_id: t.section_id, is_primary: true });
  }
  db.prepare('SELECT p.id,p.name,p.color,p.icon, tp.section_id FROM task_projects tp JOIN projects p ON p.id=tp.project_id WHERE tp.task_id=?').all(t.id)
    .forEach((p) => homes.push({ ...p, is_primary: false }));
  return homes;
}

module.exports = function registerPM(app) {
  const A = [auth];

  // ========================= TEAMS =========================
  app.get('/api/pm/teams', A, (req, res) => {
    const teams = db.prepare('SELECT * FROM teams WHERE org_id=? ORDER BY name').all(req.user.org_id);
    ok(res, teams.map((t) => ({
      ...t,
      members: db.prepare('SELECT COUNT(*) c FROM team_members WHERE team_id=?').get(t.id).c,
      projects: db.prepare('SELECT COUNT(*) c FROM projects WHERE team_id=? AND is_archived=0').get(t.id).c,
      joined: !!db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(t.id, req.user.id),
    })));
  });
  app.post('/api/pm/teams', A, (req, res) => {
    const { name, description, icon } = req.body || {};
    if (!name) return bad(res, 'Team name required');
    const r = db.prepare('INSERT INTO teams (org_id, name, description, icon) VALUES (?,?,?,?)').run(req.user.org_id, name.trim(), description || '', icon || '👥');
    db.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?,?)').run(r.lastInsertRowid, req.user.id);
    ok(res, db.prepare('SELECT * FROM teams WHERE id=?').get(r.lastInsertRowid));
  });
  app.patch('/api/pm/teams/:id', A, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id);
    if (!t || t.org_id !== req.user.org_id) return bad(res, 'Team not found', 404);
    const { name, description, icon } = req.body || {};
    db.prepare('UPDATE teams SET name=?, description=?, icon=? WHERE id=?').run(name || t.name, description != null ? description : t.description, icon || t.icon, t.id);
    ok(res, db.prepare('SELECT * FROM teams WHERE id=?').get(t.id));
  });
  app.delete('/api/pm/teams/:id', A, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id);
    if (!t || t.org_id !== req.user.org_id) return bad(res, 'Team not found', 404);
    db.prepare('DELETE FROM teams WHERE id=?').run(t.id);
    ok(res, { deleted: true });
  });
  app.post('/api/pm/teams/:id/join', A, (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id);
    if (!t || t.org_id !== req.user.org_id) return bad(res, 'Team not found', 404);
    const exists = db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(t.id, req.user.id);
    if (exists) db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(t.id, req.user.id);
    else db.prepare('INSERT INTO team_members (team_id, user_id) VALUES (?,?)').run(t.id, req.user.id);
    ok(res, { joined: !exists });
  });

  // ========================= PROJECTS =========================
  app.get('/api/pm/projects', A, (req, res) => {
    const archived = req.query.archived === '1' ? 1 : 0;
    let rows = db.prepare('SELECT * FROM projects WHERE org_id=? AND is_archived=? AND is_template=0 ORDER BY created_at DESC').all(req.user.org_id, archived);
    rows = rows.filter((p) => canAccessProject(req.user, p));
    ok(res, rows.map((p) => projectSummary(p, req.user.id)));
  });

  function projectSummary(p, userId) {
    const total = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE project_id=? AND parent_id IS NULL').get(p.id).c;
    const done = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE project_id=? AND parent_id IS NULL AND completed=1').get(p.id).c;
    const team = p.team_id ? db.prepare('SELECT name,icon FROM teams WHERE id=?').get(p.team_id) : null;
    return {
      ...p, team,
      task_total: total, task_done: done, progress: total ? Math.round((done / total) * 100) : 0,
      members: db.prepare('SELECT COUNT(*) c FROM project_members WHERE project_id=?').get(p.id).c,
      favorite: userId ? !!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND is_favorite=1').get(p.id, userId) : false,
    };
  }

  app.post('/api/pm/projects', A, (req, res) => {
    const { name, team_id, color, icon, description, privacy, default_view, template } = req.body || {};
    if (!name) return bad(res, 'Project name required');
    const r = db.prepare(
      'INSERT INTO projects (org_id, team_id, name, description, color, icon, owner_id, privacy, default_view) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(req.user.org_id, team_id || null, name.trim(), description || '', color || '#7c9bff', icon || '📁', req.user.id, privacy || 'team', default_view || 'board');
    const pid = r.lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)').run(pid, req.user.id);
    // sections: from template or defaults
    const TEMPLATES = {
      kanban: ['To Do', 'In Progress', 'In Review', 'Done'],
      sprint: ['Backlog', 'This Sprint', 'In Progress', 'Done'],
      editorial: ['Ideas', 'Writing', 'Editing', 'Published'],
      blank: ['To Do', 'Doing', 'Done'],
    };
    const secs = TEMPLATES[template] || TEMPLATES.blank;
    secs.forEach((s, i) => db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?,?,?)').run(pid, s, i));
    db.prepare("INSERT INTO custom_fields (project_id, name, type, options, position) VALUES (?,?,?,?,?)").run(pid, 'Status', 'dropdown', JSON.stringify(['Not started', 'In progress', 'Done']), 0);
    ok(res, projectSummary(db.prepare('SELECT * FROM projects WHERE id=?').get(pid), req.user.id));
  });

  app.get('/api/pm/projects/:id', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const members = db.prepare(
      'SELECT u.id,u.name,u.avatar,u.title FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=?'
    ).all(p.id);
    ok(res, {
      ...projectSummary(p, req.user.id),
      owner: p.owner_id ? db.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(p.owner_id) : null,
      members,
      sections: db.prepare('SELECT * FROM sections WHERE project_id=? ORDER BY position, id').all(p.id),
      custom_fields: db.prepare('SELECT * FROM custom_fields WHERE project_id=? ORDER BY position, id').all(p.id).map((f) => ({ ...f, options: JSON.parse(f.options || '[]') })),
      rules: db.prepare('SELECT * FROM rules WHERE project_id=? ORDER BY id').all(p.id),
      status_updates: db.prepare('SELECT s.*, u.name AS author, u.avatar FROM status_updates s LEFT JOIN users u ON u.id=s.user_id WHERE s.project_id=? ORDER BY s.created_at DESC LIMIT 20').all(p.id),
      form: { enabled: !!p.form_enabled, title: p.form_title, fields: JSON.parse(p.form_fields || '[]') },
      can_edit: isAdmin(req) || p.owner_id === req.user.id,
    });
  });

  app.patch('/api/pm/projects/:id', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const b = req.body || {};
    db.prepare(
      'UPDATE projects SET name=?, description=?, color=?, icon=?, status=?, privacy=?, default_view=?, team_id=? WHERE id=?'
    ).run(b.name || p.name, b.description != null ? b.description : p.description, b.color || p.color, b.icon || p.icon,
      b.status || p.status, b.privacy || p.privacy, b.default_view || p.default_view, b.team_id !== undefined ? (b.team_id || null) : p.team_id, p.id);
    ok(res, projectSummary(db.prepare('SELECT * FROM projects WHERE id=?').get(p.id), req.user.id));
  });
  app.post('/api/pm/projects/:id/archive', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    db.prepare('UPDATE projects SET is_archived=? WHERE id=?').run(p.is_archived ? 0 : 1, p.id);
    ok(res, { archived: !p.is_archived });
  });
  app.post('/api/pm/projects/:id/favorite', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)').run(p.id, req.user.id);
    const fav = db.prepare('SELECT is_favorite FROM project_members WHERE project_id=? AND user_id=?').get(p.id, req.user.id);
    db.prepare('UPDATE project_members SET is_favorite=? WHERE project_id=? AND user_id=?').run(fav.is_favorite ? 0 : 1, p.id, req.user.id);
    ok(res, { favorite: !fav.is_favorite });
  });
  app.delete('/api/pm/projects/:id', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!p || p.org_id !== req.user.org_id) return bad(res, 'Project not found', 404);
    if (!isAdmin(req) && p.owner_id !== req.user.id) return bad(res, 'Only the owner or an admin can delete this project', 403);
    db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
    ok(res, { deleted: true });
  });
  app.post('/api/pm/projects/:id/members', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.body?.user_id);
    if (!u || u.org_id !== req.user.org_id) return bad(res, 'User not found');
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)').run(p.id, u.id);
    ok(res, { added: true });
  });
  app.delete('/api/pm/projects/:id/members/:uid', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(p.id, req.params.uid);
    ok(res, { removed: true });
  });
  app.post('/api/pm/projects/:id/status', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const { status, title, body } = req.body || {};
    db.prepare('INSERT INTO status_updates (project_id, user_id, status, title, body) VALUES (?,?,?,?,?)').run(p.id, req.user.id, status || 'on_track', title || '', body || '');
    db.prepare('UPDATE projects SET status=? WHERE id=?').run(status || p.status, p.id);
    db.prepare('SELECT user_id FROM project_members WHERE project_id=?').all(p.id).forEach((m) =>
      notify({ org_id: p.org_id, user_id: m.user_id, actor_id: req.user.id, type: 'status', project_id: p.id, text: `posted a status update on ${p.name}` }));
    ok(res, { posted: true });
  });

  // tasks of a project (top-level, enriched) — used by all views
  app.get('/api/pm/projects/:id/tasks', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    // primary tasks of this project
    const primary = db.prepare('SELECT * FROM pm_tasks WHERE project_id=? AND parent_id IS NULL ORDER BY position, id').all(p.id);
    // multi-homed tasks (live primarily elsewhere but also placed in this project)
    const homed = db.prepare(
      `SELECT t.*, tp.section_id AS _home_section FROM task_projects tp JOIN pm_tasks t ON t.id=tp.task_id
       WHERE tp.project_id=? AND t.parent_id IS NULL AND t.project_id != ?`
    ).all(p.id, p.id);
    const out = [
      ...primary.map((t) => enrichTask(t, req.user.id)),
      ...homed.map((t) => ({ ...enrichTask(t, req.user.id), section_id: t._home_section, multihomed_here: true })),
    ];
    ok(res, out);
  });

  // ========================= SECTIONS =========================
  app.post('/api/pm/projects/:id/sections', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM sections WHERE project_id=?').get(p.id).n;
    const r = db.prepare('INSERT INTO sections (project_id, name, position) VALUES (?,?,?)').run(p.id, (req.body?.name || 'New section').trim(), pos);
    ok(res, db.prepare('SELECT * FROM sections WHERE id=?').get(r.lastInsertRowid));
  });
  app.patch('/api/pm/sections/:id', A, (req, res) => {
    const s = db.prepare('SELECT * FROM sections WHERE id=?').get(req.params.id);
    if (!s) return bad(res, 'Section not found', 404);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(s.project_id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Forbidden', 403);
    db.prepare('UPDATE sections SET name=?, position=? WHERE id=?').run(req.body?.name || s.name, req.body?.position != null ? req.body.position : s.position, s.id);
    ok(res, db.prepare('SELECT * FROM sections WHERE id=?').get(s.id));
  });
  app.delete('/api/pm/sections/:id', A, (req, res) => {
    const s = db.prepare('SELECT * FROM sections WHERE id=?').get(req.params.id);
    if (!s) return bad(res, 'Section not found', 404);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(s.project_id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Forbidden', 403);
    db.prepare('DELETE FROM sections WHERE id=?').run(s.id);
    ok(res, { deleted: true });
  });

  // ========================= TASKS =========================
  app.post('/api/pm/tasks', A, (req, res) => {
    const b = req.body || {};
    let project = null, section = null;
    if (b.project_id) {
      project = db.prepare('SELECT * FROM projects WHERE id=?').get(b.project_id);
      if (!canAccessProject(req.user, project)) return bad(res, 'Project not found', 404);
    }
    let parent = null;
    if (b.parent_id) { parent = getTaskScoped(req, b.parent_id); if (!parent) return bad(res, 'Parent task not found', 404); }
    if (!b.name) return bad(res, 'Task name required');
    const priority = ['none', 'low', 'medium', 'high'].includes(b.priority) ? b.priority : 'none';
    const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM pm_tasks WHERE project_id IS ? AND section_id IS ?').get(project ? project.id : null, b.section_id || null).n;
    const r = db.prepare(
      `INSERT INTO pm_tasks (org_id, project_id, section_id, parent_id, name, notes, assignee_id, created_by, start_date, due_date, priority, is_milestone, recurrence, points, position)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(req.user.org_id, project ? project.id : null, b.section_id || null, b.parent_id || null, b.name.trim(), b.notes || '',
      b.assignee_id || null, req.user.id, b.start_date || null, b.due_date || null, priority, b.is_milestone ? 1 : 0,
      ['daily', 'weekly', 'monthly'].includes(b.recurrence) ? b.recurrence : 'none', PRIORITY_POINTS[priority], pos);
    const task = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(r.lastInsertRowid);
    addFollower(task.id, req.user.id);
    addFollower(task.id, task.assignee_id);
    logActivity(task.id, req.user.id, 'created', task.name);
    if (task.assignee_id) notify({ org_id: task.org_id, user_id: task.assignee_id, actor_id: req.user.id, type: 'assigned', task_id: task.id, project_id: task.project_id, text: `assigned you "${task.name}"` });
    if (project) runRules(project.id, 'task_added', task, req.user.id);
    ok(res, enrichTask(db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(task.id), req.user.id));
  });

  app.get('/api/pm/tasks/:id', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const project = t.project_id ? db.prepare('SELECT id,name,color,icon FROM projects WHERE id=?').get(t.project_id) : null;
    const detail = {
      ...enrichTask(t, req.user.id),
      project,
      creator: t.created_by ? db.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(t.created_by) : null,
      subtasks: db.prepare('SELECT * FROM pm_tasks WHERE parent_id=? ORDER BY position,id').all(t.id).map((s) => enrichTask(s, req.user.id)),
      followers: db.prepare('SELECT u.id,u.name,u.avatar FROM task_followers f JOIN users u ON u.id=f.user_id WHERE f.task_id=?').all(t.id),
      dependencies: db.prepare('SELECT d.blocked_by AS id, x.name, x.completed FROM task_dependencies d JOIN pm_tasks x ON x.id=d.blocked_by WHERE d.task_id=?').all(t.id),
      attachments: db.prepare('SELECT * FROM attachments WHERE task_id=? ORDER BY id DESC').all(t.id),
      comments: db.prepare('SELECT c.*, u.name AS author, u.avatar FROM pm_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.created_at').all(t.id).map((c) => ({
        ...c,
        likes: db.prepare("SELECT COUNT(*) n FROM pm_likes WHERE target_type='comment' AND target_id=?").get(c.id).n,
        liked: !!db.prepare("SELECT 1 FROM pm_likes WHERE target_type='comment' AND target_id=? AND user_id=?").get(c.id, req.user.id),
      })),
      activity: db.prepare('SELECT a.*, u.name AS author, u.avatar FROM pm_activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.task_id=? ORDER BY a.created_at DESC LIMIT 40').all(t.id),
      custom_values: db.prepare('SELECT field_id, value FROM custom_field_values WHERE task_id=?').all(t.id),
      custom_fields: project ? db.prepare('SELECT * FROM custom_fields WHERE project_id=? ORDER BY position,id').all(project.id).map((f) => ({ ...f, options: JSON.parse(f.options || '[]') })) : [],
      homes: taskHomes(t),
    };
    ok(res, detail);
  });

  app.patch('/api/pm/tasks/:id', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const b = req.body || {};
    const before = { ...t };
    const priority = b.priority && ['none', 'low', 'medium', 'high'].includes(b.priority) ? b.priority : t.priority;
    const completed = b.completed != null ? (b.completed ? 1 : 0) : t.completed;

    // dependency gate: cannot complete while blockers open
    if (completed && !t.completed) {
      const openBlockers = db.prepare('SELECT COUNT(*) c FROM task_dependencies d JOIN pm_tasks x ON x.id=d.blocked_by WHERE d.task_id=? AND x.completed=0').get(t.id).c;
      if (openBlockers > 0) return bad(res, 'This task is blocked by unfinished dependencies');
    }
    db.prepare(
      `UPDATE pm_tasks SET name=?, notes=?, assignee_id=?, section_id=?, start_date=?, due_date=?, priority=?, is_milestone=?, recurrence=?, completed=?, completed_at=?, points=? WHERE id=?`
    ).run(
      b.name != null ? b.name : t.name,
      b.notes != null ? b.notes : t.notes,
      b.assignee_id !== undefined ? (b.assignee_id || null) : t.assignee_id,
      b.section_id !== undefined ? (b.section_id || null) : t.section_id,
      b.start_date !== undefined ? (b.start_date || null) : t.start_date,
      b.due_date !== undefined ? (b.due_date || null) : t.due_date,
      priority,
      b.is_milestone != null ? (b.is_milestone ? 1 : 0) : t.is_milestone,
      b.recurrence && ['none', 'daily', 'weekly', 'monthly'].includes(b.recurrence) ? b.recurrence : t.recurrence,
      completed,
      completed && !t.completed ? new Date().toISOString() : (completed ? t.completed_at : null),
      priority !== t.priority ? PRIORITY_POINTS[priority] : t.points,
      t.id
    );
    let task = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(t.id);

    // assignment change
    if (b.assignee_id !== undefined && (b.assignee_id || null) !== before.assignee_id) {
      addFollower(task.id, task.assignee_id);
      logActivity(task.id, req.user.id, 'assigned', task.assignee_id ? 'reassigned' : 'unassigned');
      if (task.assignee_id) notify({ org_id: task.org_id, user_id: task.assignee_id, actor_id: req.user.id, type: 'assigned', task_id: task.id, project_id: task.project_id, text: `assigned you "${task.name}"` });
      if (task.project_id) runRules(task.project_id, 'assignee_set', task, req.user.id);
    }
    if (b.section_id !== undefined && (b.section_id || null) !== before.section_id && task.project_id) {
      runRules(task.project_id, 'moved_section', task, req.user.id);
    }
    // completion transition
    if (completed && !before.completed) {
      logActivity(task.id, req.user.id, 'completed', task.name);
      maybeAward(task, req.user.id);
      followersOf(task.id).forEach((uid) => notify({ org_id: task.org_id, user_id: uid, actor_id: req.user.id, type: 'completed', task_id: task.id, project_id: task.project_id, text: `completed "${task.name}"` }));
      if (task.project_id) runRules(task.project_id, 'completed', task, req.user.id);
      // recurrence: spawn next occurrence
      if (task.recurrence !== 'none') {
        const nd = shiftDate(task.due_date || new Date().toISOString().slice(0, 10), task.recurrence);
        const sd = task.start_date ? shiftDate(task.start_date, task.recurrence) : null;
        const np = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM pm_tasks WHERE project_id IS ? AND section_id IS ?').get(task.project_id, task.section_id).n;
        db.prepare(`INSERT INTO pm_tasks (org_id, project_id, section_id, parent_id, name, notes, assignee_id, created_by, start_date, due_date, priority, is_milestone, recurrence, points, position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(task.org_id, task.project_id, task.section_id, null, task.name, task.notes, task.assignee_id, req.user.id, sd, nd, task.priority, task.is_milestone, task.recurrence, task.points, np);
      }
    } else if (!completed && before.completed) {
      logActivity(task.id, req.user.id, 'reopened', task.name);
    }
    ok(res, enrichTask(db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(task.id), req.user.id));
  });

  app.delete('/api/pm/tasks/:id', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    db.prepare('DELETE FROM pm_tasks WHERE id=?').run(t.id);
    ok(res, { deleted: true });
  });

  // subtasks
  app.post('/api/pm/tasks/:id/subtasks', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    if (!req.body?.name) return bad(res, 'Subtask name required');
    const r = db.prepare('INSERT INTO pm_tasks (org_id, project_id, section_id, parent_id, name, assignee_id, created_by, priority, points) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(t.org_id, t.project_id, t.section_id, t.id, req.body.name.trim(), req.body.assignee_id || null, req.user.id, 'none', PRIORITY_POINTS.none);
    const st = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(r.lastInsertRowid);
    logActivity(t.id, req.user.id, 'subtask', st.name);
    if (st.assignee_id) notify({ org_id: t.org_id, user_id: st.assignee_id, actor_id: req.user.id, type: 'assigned', task_id: st.id, project_id: t.project_id, text: `assigned you subtask "${st.name}"` });
    ok(res, enrichTask(st, req.user.id));
  });

  // followers
  app.post('/api/pm/tasks/:id/follow', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const uid = req.body?.user_id || req.user.id;
    const exists = db.prepare('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?').get(t.id, uid);
    if (exists) db.prepare('DELETE FROM task_followers WHERE task_id=? AND user_id=?').run(t.id, uid);
    else { db.prepare('INSERT INTO task_followers (task_id, user_id) VALUES (?,?)').run(t.id, uid); if (uid !== req.user.id) notify({ org_id: t.org_id, user_id: uid, actor_id: req.user.id, type: 'follow', task_id: t.id, project_id: t.project_id, text: `added you as collaborator on "${t.name}"` }); }
    ok(res, { following: !exists });
  });

  // dependencies
  app.post('/api/pm/tasks/:id/dependencies', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const dep = getTaskScoped(req, req.body?.blocked_by);
    if (!dep) return bad(res, 'Blocking task not found');
    if (dep.id === t.id) return bad(res, 'A task cannot block itself');
    db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, blocked_by) VALUES (?,?)').run(t.id, dep.id);
    logActivity(t.id, req.user.id, 'dependency', `blocked by ${dep.name}`);
    ok(res, { added: true });
  });
  app.delete('/api/pm/tasks/:id/dependencies/:depId', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    db.prepare('DELETE FROM task_dependencies WHERE task_id=? AND blocked_by=?').run(t.id, req.params.depId);
    ok(res, { removed: true });
  });

  // ---- multi-homing: add/move/remove a task across projects ----
  app.post('/api/pm/tasks/:id/projects', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.body?.project_id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    if (p.id === t.project_id) return bad(res, 'Task already lives in that project');
    let sectionId = req.body?.section_id || null;
    if (!sectionId) { const s = db.prepare('SELECT id FROM sections WHERE project_id=? ORDER BY position LIMIT 1').get(p.id); sectionId = s ? s.id : null; }
    db.prepare('INSERT OR IGNORE INTO task_projects (task_id, project_id, section_id) VALUES (?,?,?)').run(t.id, p.id, sectionId);
    db.prepare('UPDATE task_projects SET section_id=? WHERE task_id=? AND project_id=?').run(sectionId, t.id, p.id);
    logActivity(t.id, req.user.id, 'multihome', `added to ${p.name}`);
    runRules(p.id, 'task_added', { ...t, section_id: sectionId }, req.user.id);
    ok(res, { added: true, homes: taskHomes(db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(t.id)) });
  });
  // update the section a multi-homed task sits in, for a given project
  app.patch('/api/pm/tasks/:id/projects/:projectId', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const pid = Number(req.params.projectId);
    const sectionId = req.body?.section_id || null;
    if (pid === t.project_id) { db.prepare('UPDATE pm_tasks SET section_id=? WHERE id=?').run(sectionId, t.id); }
    else { db.prepare('UPDATE task_projects SET section_id=? WHERE task_id=? AND project_id=?').run(sectionId, t.id, pid); }
    ok(res, { updated: true });
  });
  app.delete('/api/pm/tasks/:id/projects/:projectId', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const pid = Number(req.params.projectId);
    if (pid === t.project_id) return bad(res, "Can't remove a task from its primary project — delete the task or move its home instead");
    db.prepare('DELETE FROM task_projects WHERE task_id=? AND project_id=?').run(t.id, pid);
    ok(res, { removed: true });
  });

  // tags
  app.post('/api/pm/tasks/:id/tags', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const tag = db.prepare('SELECT * FROM tags WHERE id=?').get(req.body?.tag_id);
    if (!tag || tag.org_id !== req.user.org_id) return bad(res, 'Tag not found');
    db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)').run(t.id, tag.id);
    ok(res, { added: true });
  });
  app.delete('/api/pm/tasks/:id/tags/:tagId', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    db.prepare('DELETE FROM task_tags WHERE task_id=? AND tag_id=?').run(t.id, req.params.tagId);
    ok(res, { removed: true });
  });

  // attachments (link-based)
  app.post('/api/pm/tasks/:id/attachments', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    if (!req.body?.name) return bad(res, 'Attachment name required');
    const r = db.prepare("INSERT INTO attachments (task_id, name, url, kind) VALUES (?,?,?,'link')").run(t.id, req.body.name.trim(), req.body.url || '');
    logActivity(t.id, req.user.id, 'attachment', req.body.name);
    ok(res, db.prepare('SELECT * FROM attachments WHERE id=?').get(r.lastInsertRowid));
  });
  // attachments (real file upload)
  app.post('/api/pm/tasks/:id/attachments/upload', A, upload.single('file'), (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) { if (req.file) fs.unlink(req.file.path, () => {}); return bad(res, 'Task not found', 404); }
    if (!req.file) return bad(res, 'No file uploaded');
    const r = db.prepare("INSERT INTO attachments (task_id, name, kind, path, size, mime) VALUES (?,?,'file',?,?,?)")
      .run(t.id, req.file.originalname, req.file.path, req.file.size, req.file.mimetype || '');
    logActivity(t.id, req.user.id, 'attachment', req.file.originalname);
    ok(res, db.prepare('SELECT * FROM attachments WHERE id=?').get(r.lastInsertRowid));
  });
  // authenticated download (token can be passed as ?t= for direct links)
  function attachAuth(req, res, next) {
    if (!req.headers.authorization && req.query.t) req.headers.authorization = 'Bearer ' + req.query.t;
    return auth(req, res, next);
  }
  app.get('/api/pm/attachments/:id/download', attachAuth, (req, res) => {
    const a = db.prepare('SELECT a.*, x.org_id FROM attachments a JOIN pm_tasks x ON x.id=a.task_id WHERE a.id=?').get(req.params.id);
    if (!a || a.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    if (a.kind === 'file' && a.path && fs.existsSync(a.path)) return res.download(a.path, a.name);
    if (a.url) return res.redirect(a.url);
    return bad(res, 'File unavailable', 404);
  });
  app.delete('/api/pm/attachments/:id', A, (req, res) => {
    const a = db.prepare('SELECT a.*, x.org_id FROM attachments a JOIN pm_tasks x ON x.id=a.task_id WHERE a.id=?').get(req.params.id);
    if (!a || a.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    if (a.kind === 'file' && a.path) fs.unlink(a.path, () => {});
    db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);
    ok(res, { deleted: true });
  });

  // custom field values
  app.patch('/api/pm/tasks/:id/fields', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    const { field_id, value } = req.body || {};
    if (!field_id) return bad(res, 'field_id required');
    db.prepare('INSERT INTO custom_field_values (task_id, field_id, value) VALUES (?,?,?) ON CONFLICT(task_id, field_id) DO UPDATE SET value=excluded.value').run(t.id, field_id, value || '');
    ok(res, { saved: true });
  });

  // comments + @mentions
  app.post('/api/pm/tasks/:id/comments', A, (req, res) => {
    const t = getTaskScoped(req, req.params.id);
    if (!t) return bad(res, 'Task not found', 404);
    if (!req.body?.body) return bad(res, 'Comment cannot be empty');
    const r = db.prepare('INSERT INTO pm_comments (task_id, user_id, body) VALUES (?,?,?)').run(t.id, req.user.id, req.body.body.trim());
    addFollower(t.id, req.user.id);
    logActivity(t.id, req.user.id, 'comment', '');
    // notify followers + assignee
    const recipients = new Set([...followersOf(t.id), t.assignee_id].filter(Boolean));
    // @mentions
    const orgUsers = db.prepare('SELECT id, name FROM users WHERE org_id=?').all(req.user.org_id);
    orgUsers.forEach((u) => {
      const handle = '@' + u.name.split(' ')[0].toLowerCase();
      if (req.body.body.toLowerCase().includes(handle)) { recipients.add(u.id); notify({ org_id: t.org_id, user_id: u.id, actor_id: req.user.id, type: 'mention', task_id: t.id, project_id: t.project_id, text: `mentioned you on "${t.name}"` }); }
    });
    recipients.forEach((uid) => notify({ org_id: t.org_id, user_id: uid, actor_id: req.user.id, type: 'comment', task_id: t.id, project_id: t.project_id, text: `commented on "${t.name}"` }));
    ok(res, db.prepare('SELECT c.*, u.name AS author, u.avatar FROM pm_comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?').get(r.lastInsertRowid));
  });
  app.delete('/api/pm/comments/:id', A, (req, res) => {
    const c = db.prepare('SELECT c.*, x.org_id FROM pm_comments c JOIN pm_tasks x ON x.id=c.task_id WHERE c.id=?').get(req.params.id);
    if (!c || c.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    if (c.user_id !== req.user.id && !isAdmin(req)) return bad(res, 'Forbidden', 403);
    db.prepare('DELETE FROM pm_comments WHERE id=?').run(c.id);
    ok(res, { deleted: true });
  });

  // likes (hearts) on tasks & comments
  app.post('/api/pm/like', A, (req, res) => {
    const { target_type, target_id } = req.body || {};
    if (!['task', 'comment'].includes(target_type) || !target_id) return bad(res, 'Invalid like target');
    const exists = db.prepare('SELECT 1 FROM pm_likes WHERE target_type=? AND target_id=? AND user_id=?').get(target_type, target_id, req.user.id);
    if (exists) db.prepare('DELETE FROM pm_likes WHERE target_type=? AND target_id=? AND user_id=?').run(target_type, target_id, req.user.id);
    else db.prepare('INSERT INTO pm_likes (target_type, target_id, user_id) VALUES (?,?,?)').run(target_type, target_id, req.user.id);
    const count = db.prepare('SELECT COUNT(*) c FROM pm_likes WHERE target_type=? AND target_id=?').get(target_type, target_id).c;
    ok(res, { liked: !exists, count });
  });

  // ========================= MY TASKS =========================
  app.get('/api/pm/my-tasks', A, (req, res) => {
    const rows = db.prepare(
      `SELECT t.*, p.name AS project_name, p.color AS project_color, p.icon AS project_icon
       FROM pm_tasks t LEFT JOIN projects p ON p.id=t.project_id
       WHERE t.org_id=? AND t.assignee_id=? ORDER BY t.completed, (t.due_date IS NULL), t.due_date`
    ).all(req.user.org_id, req.user.id);
    ok(res, rows.map((t) => enrichTask(t, req.user.id)));
  });

  // ========================= INBOX =========================
  app.get('/api/pm/inbox', A, (req, res) => {
    const rows = db.prepare(
      `SELECT n.*, u.name AS actor_name, u.avatar AS actor_avatar, t.name AS task_name, p.name AS project_name
       FROM notifications n LEFT JOIN users u ON u.id=n.actor_id LEFT JOIN pm_tasks t ON t.id=n.task_id LEFT JOIN projects p ON p.id=n.project_id
       WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 80`
    ).all(req.user.id);
    ok(res, rows);
  });
  app.get('/api/pm/inbox/count', A, (req, res) => ok(res, { unread: db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c }));
  app.post('/api/pm/inbox/:id/read', A, (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id); ok(res, { read: true }); });
  app.post('/api/pm/inbox/read-all', A, (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id); ok(res, { read: true }); });

  // ========================= SEARCH =========================
  app.get('/api/pm/search', A, (req, res) => {
    const q = '%' + (req.query.q || '').toLowerCase() + '%';
    const tasks = db.prepare(
      `SELECT t.id, t.name, t.completed, t.due_date, p.name AS project_name, p.color AS project_color
       FROM pm_tasks t LEFT JOIN projects p ON p.id=t.project_id
       WHERE t.org_id=? AND LOWER(t.name) LIKE ? ORDER BY t.completed LIMIT 25`).all(req.user.org_id, q);
    const projects = db.prepare('SELECT id,name,color,icon FROM projects WHERE org_id=? AND LOWER(name) LIKE ? AND is_archived=0 LIMIT 15').all(req.user.org_id, q);
    ok(res, { tasks, projects });
  });

  // ========================= TAGS =========================
  app.get('/api/pm/tags', A, (req, res) => ok(res, db.prepare('SELECT g.*, (SELECT COUNT(*) FROM task_tags WHERE tag_id=g.id) AS uses FROM tags g WHERE g.org_id=? ORDER BY g.name').all(req.user.org_id)));
  app.post('/api/pm/tags', A, (req, res) => {
    if (!req.body?.name) return bad(res, 'Tag name required');
    const r = db.prepare('INSERT INTO tags (org_id, name, color) VALUES (?,?,?)').run(req.user.org_id, req.body.name.trim(), req.body.color || '#b56bff');
    ok(res, db.prepare('SELECT * FROM tags WHERE id=?').get(r.lastInsertRowid));
  });
  app.delete('/api/pm/tags/:id', A, (req, res) => {
    const g = db.prepare('SELECT * FROM tags WHERE id=?').get(req.params.id);
    if (!g || g.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM tags WHERE id=?').run(g.id);
    ok(res, { deleted: true });
  });

  // ========================= CUSTOM FIELDS =========================
  app.post('/api/pm/projects/:id/fields', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const { name, type, options } = req.body || {};
    if (!name) return bad(res, 'Field name required');
    const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM custom_fields WHERE project_id=?').get(p.id).n;
    const r = db.prepare('INSERT INTO custom_fields (project_id, name, type, options, position) VALUES (?,?,?,?,?)').run(p.id, name.trim(), ['text', 'number', 'dropdown'].includes(type) ? type : 'text', JSON.stringify(options || []), pos);
    ok(res, db.prepare('SELECT * FROM custom_fields WHERE id=?').get(r.lastInsertRowid));
  });
  app.delete('/api/pm/fields/:id', A, (req, res) => {
    const f = db.prepare('SELECT f.*, p.org_id FROM custom_fields f JOIN projects p ON p.id=f.project_id WHERE f.id=?').get(req.params.id);
    if (!f || f.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM custom_fields WHERE id=?').run(f.id);
    ok(res, { deleted: true });
  });

  // ========================= RULES (automation) =========================
  app.post('/api/pm/projects/:id/rules', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const b = req.body || {};
    if (!b.name || !b.trigger_type || !b.action_type) return bad(res, 'Rule needs a name, trigger and action');
    const r = db.prepare('INSERT INTO rules (project_id, name, trigger_type, trigger_value, action_type, action_value) VALUES (?,?,?,?,?,?)')
      .run(p.id, b.name.trim(), b.trigger_type, b.trigger_value || '', b.action_type, b.action_value || '');
    ok(res, db.prepare('SELECT * FROM rules WHERE id=?').get(r.lastInsertRowid));
  });
  app.patch('/api/pm/rules/:id', A, (req, res) => {
    const r = db.prepare('SELECT r.*, p.org_id FROM rules r JOIN projects p ON p.id=r.project_id WHERE r.id=?').get(req.params.id);
    if (!r || r.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('UPDATE rules SET enabled=? WHERE id=?').run(req.body?.enabled ? 1 : 0, r.id);
    ok(res, { updated: true });
  });
  app.delete('/api/pm/rules/:id', A, (req, res) => {
    const r = db.prepare('SELECT r.*, p.org_id FROM rules r JOIN projects p ON p.id=r.project_id WHERE r.id=?').get(req.params.id);
    if (!r || r.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM rules WHERE id=?').run(r.id);
    ok(res, { deleted: true });
  });

  // ========================= FORMS =========================
  app.patch('/api/pm/projects/:id/form', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!canAccessProject(req.user, p)) return bad(res, 'Project not found', 404);
    const b = req.body || {};
    db.prepare('UPDATE projects SET form_enabled=?, form_title=?, form_fields=? WHERE id=?').run(b.enabled ? 1 : 0, b.title || 'Submit a request', JSON.stringify(b.fields || []), p.id);
    ok(res, { saved: true });
  });
  app.post('/api/pm/projects/:id/submit', A, (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
    if (!p || p.org_id !== req.user.org_id || !p.form_enabled) return bad(res, 'Form not available', 404);
    const b = req.body || {};
    if (!b.name) return bad(res, 'Please add a title');
    const firstSection = db.prepare('SELECT id FROM sections WHERE project_id=? ORDER BY position LIMIT 1').get(p.id);
    const notesParts = [];
    JSON.parse(p.form_fields || '[]').forEach((f) => { if (b.answers && b.answers[f]) notesParts.push(`${f}: ${b.answers[f]}`); });
    const r = db.prepare('INSERT INTO pm_tasks (org_id, project_id, section_id, name, notes, created_by, priority, points) VALUES (?,?,?,?,?,?,?,?)')
      .run(p.org_id, p.id, firstSection ? firstSection.id : null, b.name.trim(), notesParts.join('\n'), req.user.id, 'none', PRIORITY_POINTS.none);
    const task = db.prepare('SELECT * FROM pm_tasks WHERE id=?').get(r.lastInsertRowid);
    runRules(p.id, 'task_added', task, req.user.id);
    ok(res, { submitted: true });
  });

  // ========================= PORTFOLIOS =========================
  app.get('/api/pm/portfolios', A, (req, res) => {
    const rows = db.prepare('SELECT * FROM portfolios WHERE org_id=? ORDER BY created_at DESC').all(req.user.org_id);
    ok(res, rows.map((pf) => {
      const projs = db.prepare('SELECT p.* FROM portfolio_projects pp JOIN projects p ON p.id=pp.project_id WHERE pp.portfolio_id=?').all(pf.id);
      const totals = projs.reduce((acc, p) => { const s = projectSummary(p, req.user.id); acc.total += s.task_total; acc.done += s.task_done; return acc; }, { total: 0, done: 0 });
      return { ...pf, project_count: projs.length, progress: totals.total ? Math.round((totals.done / totals.total) * 100) : 0 };
    }));
  });
  app.get('/api/pm/portfolios/:id', A, (req, res) => {
    const pf = db.prepare('SELECT * FROM portfolios WHERE id=?').get(req.params.id);
    if (!pf || pf.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    const projs = db.prepare('SELECT p.* FROM portfolio_projects pp JOIN projects p ON p.id=pp.project_id WHERE pp.portfolio_id=?').all(pf.id).map((p) => projectSummary(p, req.user.id));
    ok(res, { ...pf, projects: projs });
  });
  app.post('/api/pm/portfolios', A, (req, res) => {
    if (!req.body?.name) return bad(res, 'Portfolio name required');
    const r = db.prepare('INSERT INTO portfolios (org_id, name, description, color, owner_id) VALUES (?,?,?,?,?)').run(req.user.org_id, req.body.name.trim(), req.body.description || '', req.body.color || '#34e0ff', req.user.id);
    ok(res, db.prepare('SELECT * FROM portfolios WHERE id=?').get(r.lastInsertRowid));
  });
  app.delete('/api/pm/portfolios/:id', A, (req, res) => {
    const pf = db.prepare('SELECT * FROM portfolios WHERE id=?').get(req.params.id);
    if (!pf || pf.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM portfolios WHERE id=?').run(pf.id);
    ok(res, { deleted: true });
  });
  app.post('/api/pm/portfolios/:id/projects', A, (req, res) => {
    const pf = db.prepare('SELECT * FROM portfolios WHERE id=?').get(req.params.id);
    if (!pf || pf.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.body?.project_id);
    if (!p || p.org_id !== req.user.org_id) return bad(res, 'Project not found');
    db.prepare('INSERT OR IGNORE INTO portfolio_projects (portfolio_id, project_id) VALUES (?,?)').run(pf.id, p.id);
    ok(res, { added: true });
  });
  app.delete('/api/pm/portfolios/:id/projects/:pid', A, (req, res) => {
    const pf = db.prepare('SELECT * FROM portfolios WHERE id=?').get(req.params.id);
    if (!pf || pf.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM portfolio_projects WHERE portfolio_id=? AND project_id=?').run(pf.id, req.params.pid);
    ok(res, { removed: true });
  });

  // ========================= GOALS =========================
  app.get('/api/pm/goals', A, (req, res) => {
    const rows = db.prepare('SELECT g.*, u.name AS owner_name, u.avatar AS owner_avatar FROM goals g LEFT JOIN users u ON u.id=g.owner_id WHERE g.org_id=? ORDER BY g.created_at DESC').all(req.user.org_id);
    ok(res, rows.map((g) => ({ ...g, linked: db.prepare('SELECT COUNT(*) c FROM goal_projects WHERE goal_id=?').get(g.id).c })));
  });
  app.post('/api/pm/goals', A, (req, res) => {
    if (!req.body?.name) return bad(res, 'Goal name required');
    const b = req.body;
    const r = db.prepare('INSERT INTO goals (org_id, name, description, owner_id, status, progress, due_date) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.org_id, b.name.trim(), b.description || '', b.owner_id || req.user.id, b.status || 'on_track', Number(b.progress) || 0, b.due_date || null);
    ok(res, db.prepare('SELECT * FROM goals WHERE id=?').get(r.lastInsertRowid));
  });
  app.patch('/api/pm/goals/:id', A, (req, res) => {
    const g = db.prepare('SELECT * FROM goals WHERE id=?').get(req.params.id);
    if (!g || g.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    const b = req.body || {};
    db.prepare('UPDATE goals SET name=?, description=?, status=?, progress=?, due_date=?, owner_id=? WHERE id=?')
      .run(b.name || g.name, b.description != null ? b.description : g.description, b.status || g.status, b.progress != null ? Number(b.progress) : g.progress, b.due_date !== undefined ? b.due_date : g.due_date, b.owner_id || g.owner_id, g.id);
    ok(res, db.prepare('SELECT * FROM goals WHERE id=?').get(g.id));
  });
  app.delete('/api/pm/goals/:id', A, (req, res) => {
    const g = db.prepare('SELECT * FROM goals WHERE id=?').get(req.params.id);
    if (!g || g.org_id !== req.user.org_id) return bad(res, 'Not found', 404);
    db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
    ok(res, { deleted: true });
  });

  // ========================= WORKLOAD =========================
  app.get('/api/pm/workload', A, (req, res) => {
    const members = db.prepare("SELECT id,name,avatar FROM users WHERE org_id=? AND role IN ('employee','org_admin')").all(req.user.org_id);
    ok(res, members.map((m) => {
      const open = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE assignee_id=? AND completed=0 AND parent_id IS NULL').get(m.id).c;
      const overdue = db.prepare("SELECT COUNT(*) c FROM pm_tasks WHERE assignee_id=? AND completed=0 AND due_date IS NOT NULL AND due_date < date('now')").get(m.id).c;
      const done = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE assignee_id=? AND completed=1').get(m.id).c;
      return { ...m, open, overdue, done, capacity: Math.min(100, Math.round((open / 8) * 100)) };
    }).sort((a, b) => b.open - a.open));
  });

  // ========================= REPORTING =========================
  app.get('/api/pm/reporting', A, (req, res) => {
    const org = req.user.org_id;
    const totalTasks = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE org_id=? AND parent_id IS NULL').get(org).c;
    const completed = db.prepare('SELECT COUNT(*) c FROM pm_tasks WHERE org_id=? AND parent_id IS NULL AND completed=1').get(org).c;
    const overdue = db.prepare("SELECT COUNT(*) c FROM pm_tasks WHERE org_id=? AND completed=0 AND due_date IS NOT NULL AND due_date < date('now')").get(org).c;
    const projects = db.prepare('SELECT COUNT(*) c FROM projects WHERE org_id=? AND is_archived=0').get(org).c;
    const byPriority = db.prepare("SELECT priority, COUNT(*) c FROM pm_tasks WHERE org_id=? AND completed=0 AND parent_id IS NULL GROUP BY priority").all(org);
    const byProject = db.prepare(
      `SELECT p.name, p.color, COUNT(t.id) total, COALESCE(SUM(t.completed),0) done
       FROM projects p LEFT JOIN pm_tasks t ON t.project_id=p.id AND t.parent_id IS NULL
       WHERE p.org_id=? AND p.is_archived=0 GROUP BY p.id ORDER BY total DESC LIMIT 8`).all(org);
    const byAssignee = db.prepare(
      `SELECT u.name, u.avatar, COUNT(t.id) total, COALESCE(SUM(t.completed),0) done
       FROM users u JOIN pm_tasks t ON t.assignee_id=u.id AND t.parent_id IS NULL
       WHERE u.org_id=? GROUP BY u.id ORDER BY total DESC LIMIT 8`).all(org);
    // completion over last 7 days
    const trend = db.prepare(
      `SELECT date(completed_at) d, COUNT(*) c FROM pm_tasks
       WHERE org_id=? AND completed=1 AND completed_at >= date('now','-6 days') GROUP BY date(completed_at)`).all(org);
    ok(res, { totalTasks, completed, overdue, projects, completionRate: totalTasks ? Math.round((completed / totalTasks) * 100) : 0, byPriority, byProject, byAssignee, trend });
  });

  // org members helper for pickers
  app.get('/api/pm/people', A, (req, res) => ok(res, db.prepare("SELECT id,name,avatar,title FROM users WHERE org_id=? AND role IN ('employee','org_admin') ORDER BY name").all(req.user.org_id).map((u) => u)));
};
