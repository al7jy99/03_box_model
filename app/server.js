'use strict';

const path = require('path');
const express = require('express');
const {
  db,
  hashPassword,
  checkPassword,
  signToken,
  verifyToken,
  award,
  badgesFor,
  publicUser,
  uniqueSlug,
  levelFor,
} = require('./lib');

const app = express();
app.use(express.json());

// ---------- middleware ----------
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
  if (!user || user.status === 'disabled')
    return res.status(401).json({ error: 'Account unavailable' });
  if (user.org_id) {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
    if (org && org.status === 'suspended' && user.role !== 'super_admin')
      return res.status(403).json({ error: 'Organization suspended' });
  }
  req.user = user;
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: 'Forbidden' });
  next();
};

// helper: enforce same-org access for org-scoped resources
function sameOrg(req, orgId) {
  return req.user.role === 'super_admin' || req.user.org_id === orgId;
}

const ok = (res, data) => res.json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ============================================================
// AUTH
// ============================================================
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, 'Email and password required');
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email).toLowerCase().trim());
  if (!user || !checkPassword(password, user.password_hash))
    return bad(res, 'Invalid email or password', 401);
  if (user.status === 'disabled') return bad(res, 'Account disabled', 403);
  const org = user.org_id
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id)
    : null;
  ok(res, { token: signToken(user), user: publicUser(user), org });
});

// Self-serve SaaS signup: creates an organization + its first admin.
app.post('/api/auth/signup', (req, res) => {
  const { orgName, name, email, password } = req.body || {};
  if (!orgName || !name || !email || !password)
    return bad(res, 'Organization, name, email and password are required');
  const cleanEmail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail))
    return bad(res, 'An account with that email already exists');
  const slug = uniqueSlug(orgName);
  const result = db.transaction(() => {
    const org = db
      .prepare('INSERT INTO organizations (name, slug) VALUES (?,?)')
      .run(orgName.trim(), slug);
    const admin = db
      .prepare(
        'INSERT INTO users (org_id, email, password_hash, name, role, title, avatar) VALUES (?,?,?,?,?,?,?)'
      )
      .run(org.lastInsertRowid, cleanEmail, hashPassword(password), name.trim(), 'org_admin', 'Administrator', '👑');
    return { orgId: org.lastInsertRowid, userId: admin.lastInsertRowid };
  })();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.userId);
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(result.orgId);
  ok(res, { token: signToken(user), user: publicUser(user), org });
});

app.get('/api/auth/me', auth, (req, res) => {
  const org = req.user.org_id
    ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id)
    : null;
  ok(res, { user: publicUser(req.user), org });
});

// ============================================================
// SUPER ADMIN (platform owner)
// ============================================================
app.get('/api/super/stats', auth, requireRole('super_admin'), (req, res) => {
  const orgs = db.prepare('SELECT COUNT(*) c FROM organizations').get().c;
  const activeOrgs = db.prepare("SELECT COUNT(*) c FROM organizations WHERE status='active'").get().c;
  const users = db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'super_admin'").get().c;
  const tasks = db.prepare('SELECT COUNT(*) c FROM tasks').get().c;
  const ideas = db.prepare('SELECT COUNT(*) c FROM ideas').get().c;
  const redemptions = db.prepare('SELECT COUNT(*) c FROM redemptions').get().c;
  const pointsAwarded = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE amount > 0").get().s;
  ok(res, { orgs, activeOrgs, users, tasks, ideas, redemptions, pointsAwarded });
});

app.get('/api/super/orgs', auth, requireRole('super_admin'), (req, res) => {
  const orgs = db
    .prepare(
      `SELECT o.*,
        (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS members,
        (SELECT COUNT(*) FROM tasks t WHERE t.org_id = o.id) AS tasks,
        (SELECT COUNT(*) FROM ideas i WHERE i.org_id = o.id) AS ideas,
        (SELECT email FROM users u WHERE u.org_id = o.id AND u.role='org_admin' ORDER BY u.id LIMIT 1) AS admin_email
       FROM organizations o ORDER BY o.created_at DESC`
    )
    .all();
  ok(res, orgs);
});

app.post('/api/super/orgs', auth, requireRole('super_admin'), (req, res) => {
  const { orgName, plan, seats, adminName, adminEmail, adminPassword } = req.body || {};
  if (!orgName || !adminName || !adminEmail || !adminPassword)
    return bad(res, 'Organization and admin details are required');
  const cleanEmail = String(adminEmail).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail))
    return bad(res, 'Admin email already in use');
  const slug = uniqueSlug(orgName);
  const out = db.transaction(() => {
    const org = db
      .prepare('INSERT INTO organizations (name, slug, plan, seats) VALUES (?,?,?,?)')
      .run(orgName.trim(), slug, plan || 'free', Number(seats) || 25);
    db.prepare(
      'INSERT INTO users (org_id, email, password_hash, name, role, title, avatar) VALUES (?,?,?,?,?,?,?)'
    ).run(org.lastInsertRowid, cleanEmail, hashPassword(adminPassword), adminName.trim(), 'org_admin', 'Administrator', '👑');
    return org.lastInsertRowid;
  })();
  ok(res, db.prepare('SELECT * FROM organizations WHERE id = ?').get(out));
});

app.patch('/api/super/orgs/:id', auth, requireRole('super_admin'), (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return bad(res, 'Organization not found', 404);
  const { status, plan, seats, name } = req.body || {};
  db.prepare(
    'UPDATE organizations SET status = ?, plan = ?, seats = ?, name = ? WHERE id = ?'
  ).run(
    status || org.status,
    plan || org.plan,
    seats != null ? Number(seats) : org.seats,
    name || org.name,
    org.id
  );
  ok(res, db.prepare('SELECT * FROM organizations WHERE id = ?').get(org.id));
});

app.delete('/api/super/orgs/:id', auth, requireRole('super_admin'), (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return bad(res, 'Organization not found', 404);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(org.id);
  ok(res, { deleted: true });
});

// ============================================================
// MEMBERS (org admin manages employees)
// ============================================================
app.get('/api/members', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const members = db
    .prepare("SELECT * FROM users WHERE org_id = ? ORDER BY points DESC, name")
    .all(req.user.org_id);
  ok(res, members.map(publicUser));
});

app.post('/api/members', auth, requireRole('org_admin'), (req, res) => {
  const { name, email, password, title, avatar, role } = req.body || {};
  if (!name || !email || !password) return bad(res, 'Name, email and password are required');
  const cleanEmail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail))
    return bad(res, 'Email already in use');
  const count = db.prepare('SELECT COUNT(*) c FROM users WHERE org_id = ?').get(req.user.org_id).c;
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);
  if (count >= org.seats) return bad(res, `Seat limit reached (${org.seats}). Upgrade your plan.`);
  const newRole = role === 'org_admin' ? 'org_admin' : 'employee';
  const r = db
    .prepare(
      'INSERT INTO users (org_id, email, password_hash, name, role, title, avatar) VALUES (?,?,?,?,?,?,?)'
    )
    .run(req.user.org_id, cleanEmail, hashPassword(password), name.trim(), newRole, title || '', avatar || '🙂');
  ok(res, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)));
});

app.patch('/api/members/:id', auth, requireRole('org_admin'), (req, res) => {
  const m = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!m || m.org_id !== req.user.org_id) return bad(res, 'Member not found', 404);
  const { name, title, avatar, status, role, password } = req.body || {};
  db.prepare(
    'UPDATE users SET name=?, title=?, avatar=?, status=?, role=? WHERE id=?'
  ).run(
    name || m.name,
    title != null ? title : m.title,
    avatar || m.avatar,
    status || m.status,
    role && (role === 'org_admin' || role === 'employee') ? role : m.role,
    m.id
  );
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), m.id);
  ok(res, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(m.id)));
});

app.delete('/api/members/:id', auth, requireRole('org_admin'), (req, res) => {
  const m = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!m || m.org_id !== req.user.org_id) return bad(res, 'Member not found', 404);
  if (m.id === req.user.id) return bad(res, 'You cannot remove yourself');
  db.prepare('DELETE FROM users WHERE id = ?').run(m.id);
  ok(res, { deleted: true });
});

// Manual point award/adjust (admin)
app.post('/api/members/:id/award', auth, requireRole('org_admin'), (req, res) => {
  const m = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!m || m.org_id !== req.user.org_id) return bad(res, 'Member not found', 404);
  const amount = parseInt(req.body?.amount, 10);
  if (!amount) return bad(res, 'Amount required');
  const updated = award(m.id, amount, 'manual', req.body?.reason || 'Manual adjustment by admin');
  ok(res, publicUser(updated));
});

// ============================================================
// TASKS
// ============================================================
app.get('/api/tasks', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.name AS assignee_name, u.avatar AS assignee_avatar
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.org_id = ? ORDER BY t.created_at DESC`
    )
    .all(req.user.org_id);
  ok(res, rows);
});

app.post('/api/tasks', auth, requireRole('org_admin'), (req, res) => {
  const { title, description, points, assigned_to, priority, due_date } = req.body || {};
  if (!title) return bad(res, 'Title is required');
  let assignee = null;
  if (assigned_to) {
    const a = db.prepare('SELECT * FROM users WHERE id = ?').get(assigned_to);
    if (!a || a.org_id !== req.user.org_id) return bad(res, 'Invalid assignee');
    assignee = a.id;
  }
  const r = db
    .prepare(
      `INSERT INTO tasks (org_id, title, description, points, assigned_to, created_by, status, priority, due_date)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.org_id,
      title.trim(),
      description || '',
      Number(points) || 10,
      assignee,
      req.user.id,
      assignee ? 'in_progress' : 'open',
      priority || 'medium',
      due_date || null
    );
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid));
});

app.patch('/api/tasks/:id', auth, requireRole('org_admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  const { title, description, points, assigned_to, priority, due_date, status } = req.body || {};
  db.prepare(
    `UPDATE tasks SET title=?, description=?, points=?, assigned_to=?, priority=?, due_date=?, status=? WHERE id=?`
  ).run(
    title || t.title,
    description != null ? description : t.description,
    points != null ? Number(points) : t.points,
    assigned_to !== undefined ? assigned_to || null : t.assigned_to,
    priority || t.priority,
    due_date !== undefined ? due_date : t.due_date,
    status || t.status,
    t.id
  );
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

app.delete('/api/tasks/:id', auth, requireRole('org_admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  ok(res, { deleted: true });
});

// Employee claims an open task
app.post('/api/tasks/:id/claim', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  if (t.assigned_to && t.assigned_to !== req.user.id) return bad(res, 'Task already claimed');
  db.prepare("UPDATE tasks SET assigned_to=?, status='in_progress' WHERE id=?").run(req.user.id, t.id);
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

// Employee submits a task for review
app.post('/api/tasks/:id/submit', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  if (t.assigned_to !== req.user.id) return bad(res, 'This task is not assigned to you');
  if (t.status === 'completed') return bad(res, 'Task already completed');
  db.prepare("UPDATE tasks SET status='submitted' WHERE id=?").run(t.id);
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

// Admin approves a submitted task -> award points
app.post('/api/tasks/:id/approve', auth, requireRole('org_admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  if (t.status === 'completed') return bad(res, 'Task already completed');
  if (!t.assigned_to) return bad(res, 'Task has no assignee to reward');
  db.transaction(() => {
    db.prepare("UPDATE tasks SET status='completed', completed_at=datetime('now') WHERE id=?").run(t.id);
    award(t.assigned_to, t.points, 'task', `Task completed: ${t.title}`);
  })();
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

// Admin sends a submitted task back
app.post('/api/tasks/:id/reject', auth, requireRole('org_admin'), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!t || t.org_id !== req.user.org_id) return bad(res, 'Task not found', 404);
  db.prepare("UPDATE tasks SET status='in_progress' WHERE id=?").run(t.id);
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id));
});

// ============================================================
// CHALLENGES
// ============================================================
app.get('/api/challenges', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM challenge_participants p WHERE p.challenge_id = c.id) AS participants,
         (SELECT COUNT(*) FROM challenge_participants p WHERE p.challenge_id = c.id AND p.completed=1) AS finishers
       FROM challenges c WHERE c.org_id = ? ORDER BY c.created_at DESC`
    )
    .all(req.user.org_id);
  const mine = db
    .prepare('SELECT * FROM challenge_participants WHERE user_id = ?')
    .all(req.user.id);
  const byId = Object.fromEntries(mine.map((m) => [m.challenge_id, m]));
  ok(res, rows.map((c) => ({ ...c, me: byId[c.id] || null })));
});

app.post('/api/challenges', auth, requireRole('org_admin'), (req, res) => {
  const { title, description, points, goal, unit, start_date, end_date } = req.body || {};
  if (!title) return bad(res, 'Title is required');
  const r = db
    .prepare(
      `INSERT INTO challenges (org_id, title, description, points, goal, unit, start_date, end_date)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.org_id,
      title.trim(),
      description || '',
      Number(points) || 50,
      Number(goal) || 1,
      unit || 'steps',
      start_date || null,
      end_date || null
    );
  ok(res, db.prepare('SELECT * FROM challenges WHERE id = ?').get(r.lastInsertRowid));
});

app.patch('/api/challenges/:id', auth, requireRole('org_admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!c || c.org_id !== req.user.org_id) return bad(res, 'Challenge not found', 404);
  const { title, description, points, goal, unit, status, end_date } = req.body || {};
  db.prepare(
    `UPDATE challenges SET title=?, description=?, points=?, goal=?, unit=?, status=?, end_date=? WHERE id=?`
  ).run(
    title || c.title,
    description != null ? description : c.description,
    points != null ? Number(points) : c.points,
    goal != null ? Number(goal) : c.goal,
    unit || c.unit,
    status || c.status,
    end_date !== undefined ? end_date : c.end_date,
    c.id
  );
  ok(res, db.prepare('SELECT * FROM challenges WHERE id = ?').get(c.id));
});

app.delete('/api/challenges/:id', auth, requireRole('org_admin'), (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!c || c.org_id !== req.user.org_id) return bad(res, 'Challenge not found', 404);
  db.prepare('DELETE FROM challenges WHERE id = ?').run(c.id);
  ok(res, { deleted: true });
});

app.post('/api/challenges/:id/join', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!c || c.org_id !== req.user.org_id) return bad(res, 'Challenge not found', 404);
  db.prepare(
    'INSERT OR IGNORE INTO challenge_participants (challenge_id, user_id) VALUES (?,?)'
  ).run(c.id, req.user.id);
  ok(res, db.prepare('SELECT * FROM challenge_participants WHERE challenge_id=? AND user_id=?').get(c.id, req.user.id));
});

// Log progress; auto-completes and rewards when goal reached
app.post('/api/challenges/:id/progress', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!c || c.org_id !== req.user.org_id) return bad(res, 'Challenge not found', 404);
  const amount = parseInt(req.body?.amount, 10) || 1;
  let p = db.prepare('SELECT * FROM challenge_participants WHERE challenge_id=? AND user_id=?').get(c.id, req.user.id);
  if (!p) {
    db.prepare('INSERT INTO challenge_participants (challenge_id, user_id) VALUES (?,?)').run(c.id, req.user.id);
    p = db.prepare('SELECT * FROM challenge_participants WHERE challenge_id=? AND user_id=?').get(c.id, req.user.id);
  }
  if (p.completed) return bad(res, 'You already finished this challenge');
  const newProgress = Math.min(c.goal, p.progress + amount);
  const justCompleted = newProgress >= c.goal;
  db.transaction(() => {
    db.prepare('UPDATE challenge_participants SET progress=?, completed=? WHERE id=?').run(
      newProgress,
      justCompleted ? 1 : 0,
      p.id
    );
    if (justCompleted) award(req.user.id, c.points, 'challenge', `Challenge completed: ${c.title}`);
  })();
  ok(res, {
    participant: db.prepare('SELECT * FROM challenge_participants WHERE id=?').get(p.id),
    completed: justCompleted,
  });
});

// ============================================================
// IDEAS
// ============================================================
app.get('/api/ideas', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, u.name AS author, u.avatar AS author_avatar,
         (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes,
         (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id AND v.user_id = ?) AS voted
       FROM ideas i LEFT JOIN users u ON u.id = i.user_id
       WHERE i.org_id = ? ORDER BY votes DESC, i.created_at DESC`
    )
    .all(req.user.id, req.user.org_id);
  ok(res, rows);
});

app.post('/api/ideas', auth, (req, res) => {
  const { title, description, category } = req.body || {};
  if (!title) return bad(res, 'Title is required');
  const r = db
    .prepare('INSERT INTO ideas (org_id, user_id, title, description, category) VALUES (?,?,?,?,?)')
    .run(req.user.org_id, req.user.id, title.trim(), description || '', category || 'general');
  // small reward for contributing an idea
  award(req.user.id, 5, 'idea', `Submitted idea: ${title.trim()}`);
  ok(res, db.prepare('SELECT * FROM ideas WHERE id = ?').get(r.lastInsertRowid));
});

app.post('/api/ideas/:id/vote', auth, (req, res) => {
  const i = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!i || i.org_id !== req.user.org_id) return bad(res, 'Idea not found', 404);
  const existing = db.prepare('SELECT * FROM idea_votes WHERE idea_id=? AND user_id=?').get(i.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM idea_votes WHERE id=?').run(existing.id);
  } else {
    db.prepare('INSERT INTO idea_votes (idea_id, user_id) VALUES (?,?)').run(i.id, req.user.id);
  }
  const votes = db.prepare('SELECT COUNT(*) c FROM idea_votes WHERE idea_id=?').get(i.id).c;
  ok(res, { votes, voted: !existing });
});

// Admin updates idea status; awards bonus when approved/implemented (once)
app.patch('/api/ideas/:id', auth, requireRole('org_admin'), (req, res) => {
  const i = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!i || i.org_id !== req.user.org_id) return bad(res, 'Idea not found', 404);
  const status = req.body?.status;
  const valid = ['pending', 'under_review', 'approved', 'implemented', 'rejected'];
  if (!valid.includes(status)) return bad(res, 'Invalid status');
  const wasRewarded = ['approved', 'implemented'].includes(i.status);
  const nowRewarded = ['approved', 'implemented'].includes(status);
  db.transaction(() => {
    db.prepare('UPDATE ideas SET status=? WHERE id=?').run(status, i.id);
    if (!wasRewarded && nowRewarded && i.user_id) {
      const bonus = status === 'implemented' ? 100 : 40;
      award(i.user_id, bonus, 'idea', `Idea ${status}: ${i.title}`);
    }
  })();
  ok(res, db.prepare('SELECT * FROM ideas WHERE id = ?').get(i.id));
});

app.delete('/api/ideas/:id', auth, (req, res) => {
  const i = db.prepare('SELECT * FROM ideas WHERE id = ?').get(req.params.id);
  if (!i || i.org_id !== req.user.org_id) return bad(res, 'Idea not found', 404);
  if (req.user.role !== 'org_admin' && i.user_id !== req.user.id)
    return bad(res, 'You can only delete your own idea', 403);
  db.prepare('DELETE FROM ideas WHERE id = ?').run(i.id);
  ok(res, { deleted: true });
});

// ============================================================
// REWARDS + REDEMPTIONS
// ============================================================
app.get('/api/rewards', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const showAll = req.user.role === 'org_admin';
  const rows = db
    .prepare(
      `SELECT * FROM rewards WHERE org_id = ? ${showAll ? '' : 'AND active = 1'} ORDER BY cost ASC`
    )
    .all(req.user.org_id);
  ok(res, rows);
});

app.post('/api/rewards', auth, requireRole('org_admin'), (req, res) => {
  const { title, description, cost, icon, stock } = req.body || {};
  if (!title) return bad(res, 'Title is required');
  const r = db
    .prepare('INSERT INTO rewards (org_id, title, description, cost, icon, stock) VALUES (?,?,?,?,?,?)')
    .run(req.user.org_id, title.trim(), description || '', Number(cost) || 100, icon || '🎁', stock != null ? Number(stock) : -1);
  ok(res, db.prepare('SELECT * FROM rewards WHERE id = ?').get(r.lastInsertRowid));
});

app.patch('/api/rewards/:id', auth, requireRole('org_admin'), (req, res) => {
  const rw = db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id);
  if (!rw || rw.org_id !== req.user.org_id) return bad(res, 'Reward not found', 404);
  const { title, description, cost, icon, stock, active } = req.body || {};
  db.prepare(
    'UPDATE rewards SET title=?, description=?, cost=?, icon=?, stock=?, active=? WHERE id=?'
  ).run(
    title || rw.title,
    description != null ? description : rw.description,
    cost != null ? Number(cost) : rw.cost,
    icon || rw.icon,
    stock != null ? Number(stock) : rw.stock,
    active != null ? (active ? 1 : 0) : rw.active,
    rw.id
  );
  ok(res, db.prepare('SELECT * FROM rewards WHERE id = ?').get(rw.id));
});

app.delete('/api/rewards/:id', auth, requireRole('org_admin'), (req, res) => {
  const rw = db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id);
  if (!rw || rw.org_id !== req.user.org_id) return bad(res, 'Reward not found', 404);
  db.prepare('DELETE FROM rewards WHERE id = ?').run(rw.id);
  ok(res, { deleted: true });
});

// Employee redeems a reward (deducts stars immediately, pending fulfilment)
app.post('/api/rewards/:id/redeem', auth, (req, res) => {
  const rw = db.prepare('SELECT * FROM rewards WHERE id = ?').get(req.params.id);
  if (!rw || rw.org_id !== req.user.org_id || !rw.active) return bad(res, 'Reward unavailable', 404);
  if (rw.stock === 0) return bad(res, 'Out of stock');
  if (req.user.stars < rw.cost) return bad(res, 'Not enough stars to redeem this reward');
  const out = db.transaction(() => {
    award(req.user.id, -rw.cost, 'redemption', `Redeemed: ${rw.title}`);
    if (rw.stock > 0) db.prepare('UPDATE rewards SET stock = stock - 1 WHERE id = ?').run(rw.id);
    const r = db
      .prepare(
        'INSERT INTO redemptions (org_id, user_id, reward_id, reward_title, cost) VALUES (?,?,?,?,?)'
      )
      .run(req.user.org_id, req.user.id, rw.id, rw.title, rw.cost);
    return r.lastInsertRowid;
  })();
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  ok(res, {
    redemption: db.prepare('SELECT * FROM redemptions WHERE id = ?').get(out),
    user: publicUser(updated),
  });
});

app.get('/api/redemptions', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const isAdmin = req.user.role === 'org_admin';
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS user_name, u.avatar AS user_avatar
       FROM redemptions r JOIN users u ON u.id = r.user_id
       WHERE r.org_id = ? ${isAdmin ? '' : 'AND r.user_id = ?'}
       ORDER BY r.created_at DESC`
    )
    .all(...(isAdmin ? [req.user.org_id] : [req.user.org_id, req.user.id]));
  ok(res, rows);
});

// Admin updates redemption status; refunds stars if rejected
app.patch('/api/redemptions/:id', auth, requireRole('org_admin'), (req, res) => {
  const r = db.prepare('SELECT * FROM redemptions WHERE id = ?').get(req.params.id);
  if (!r || r.org_id !== req.user.org_id) return bad(res, 'Redemption not found', 404);
  const status = req.body?.status;
  const valid = ['pending', 'approved', 'fulfilled', 'rejected'];
  if (!valid.includes(status)) return bad(res, 'Invalid status');
  db.transaction(() => {
    if (status === 'rejected' && r.status !== 'rejected') {
      award(r.user_id, r.cost, 'redemption', `Refund: ${r.reward_title}`);
    }
    db.prepare('UPDATE redemptions SET status=?, note=? WHERE id=?').run(status, req.body?.note || r.note, r.id);
  })();
  ok(res, db.prepare('SELECT * FROM redemptions WHERE id = ?').get(r.id));
});

// ============================================================
// LEADERBOARD / PROFILE / ANALYTICS
// ============================================================
app.get('/api/leaderboard', auth, requireRole('org_admin', 'employee'), (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, name, avatar, title, points, stars FROM users WHERE org_id = ? AND role='employee' ORDER BY points DESC, name LIMIT 100"
    )
    .all(req.user.org_id);
  ok(res, rows.map((u, idx) => ({ rank: idx + 1, ...u, level: levelFor(u.points).level })));
});

app.get('/api/me/profile', auth, (req, res) => {
  const tx = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
    .all(req.user.id);
  ok(res, {
    user: publicUser(req.user),
    badges: req.user.org_id ? badgesFor(req.user.id) : [],
    transactions: tx,
  });
});

app.patch('/api/me/profile', auth, (req, res) => {
  const { name, title, avatar, password } = req.body || {};
  db.prepare('UPDATE users SET name=?, title=?, avatar=? WHERE id=?').run(
    name || req.user.name,
    title != null ? title : req.user.title,
    avatar || req.user.avatar,
    req.user.id
  );
  if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), req.user.id);
  ok(res, publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.get('/api/analytics', auth, requireRole('org_admin'), (req, res) => {
  const org = req.user.org_id;
  const members = db.prepare("SELECT COUNT(*) c FROM users WHERE org_id=? AND role='employee'").get(org).c;
  const tasksOpen = db.prepare("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status NOT IN ('completed')").get(org).c;
  const tasksDone = db.prepare("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status='completed'").get(org).c;
  const pendingReview = db.prepare("SELECT COUNT(*) c FROM tasks WHERE org_id=? AND status='submitted'").get(org).c;
  const ideasPending = db.prepare("SELECT COUNT(*) c FROM ideas WHERE org_id=? AND status='pending'").get(org).c;
  const ideasTotal = db.prepare('SELECT COUNT(*) c FROM ideas WHERE org_id=?').get(org).c;
  const challenges = db.prepare("SELECT COUNT(*) c FROM challenges WHERE org_id=? AND status='active'").get(org).c;
  const pendingRedemptions = db.prepare("SELECT COUNT(*) c FROM redemptions WHERE org_id=? AND status='pending'").get(org).c;
  const starsInCirculation = db.prepare("SELECT COALESCE(SUM(stars),0) s FROM users WHERE org_id=?").get(org).s;
  const pointsAwarded = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE org_id=? AND amount>0").get(org).s;
  const topMembers = db
    .prepare("SELECT name, avatar, points FROM users WHERE org_id=? AND role='employee' ORDER BY points DESC LIMIT 5")
    .all(org);
  const recent = db
    .prepare(
      `SELECT t.amount, t.kind, t.reason, t.created_at, u.name AS user_name
       FROM transactions t JOIN users u ON u.id=t.user_id
       WHERE t.org_id=? ORDER BY t.created_at DESC LIMIT 12`
    )
    .all(org);
  ok(res, {
    members, tasksOpen, tasksDone, pendingReview, ideasPending, ideasTotal,
    challenges, pendingRedemptions, starsInCirculation, pointsAwarded, topMembers, recent,
  });
});

// ---------- project-management (Asana-style) module ----------
require('./pm')(app);

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
// The single-page app lives under /app; everything else falls back to the
// marketing landing page (public/index.html).
app.get(['/app', '/app/*'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'app.html'))
);
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`StarBoard running on http://localhost:${PORT}`));
}

module.exports = app;
