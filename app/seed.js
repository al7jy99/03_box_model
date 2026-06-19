'use strict';

// Seeds the platform with a super admin and a demo organization full of data.
// Safe to re-run: it clears existing data first.

const { db, hashPassword, award } = require('./lib');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'abdullah.alhejji99@gmail.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super1234';

function reset() {
  const tables = [
    'transactions', 'redemptions', 'rewards', 'idea_votes', 'ideas',
    'challenge_participants', 'challenges', 'tasks',
    // project-management layer
    'pm_activity', 'notifications', 'pm_likes', 'attachments', 'custom_field_values',
    'custom_fields', 'pm_comments', 'task_dependencies', 'task_followers', 'task_tags',
    'tags', 'pm_tasks', 'rules', 'status_updates', 'sections', 'project_members',
    'goal_projects', 'goals', 'portfolio_projects', 'portfolios', 'projects',
    'team_members', 'teams',
    'users', 'organizations',
  ];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM sqlite_sequence").run();
  db.pragma('foreign_keys = ON');
}

function run() {
  reset();

  // ---- super admin (platform owner) ----
  db.prepare(
    'INSERT INTO users (org_id, email, password_hash, name, role, title, avatar) VALUES (?,?,?,?,?,?,?)'
  ).run(null, SUPER_ADMIN_EMAIL, hashPassword(SUPER_ADMIN_PASSWORD), 'Abdullah (Platform Owner)', 'super_admin', 'Founder', '🛡️');

  // ---- demo organization ----
  const org = db
    .prepare("INSERT INTO organizations (name, slug, plan, seats) VALUES (?,?,?,?)")
    .run('Acme Innovations', 'acme', 'pro', 50).lastInsertRowid;

  const mk = (email, name, role, title, avatar) =>
    db
      .prepare('INSERT INTO users (org_id, email, password_hash, name, role, title, avatar) VALUES (?,?,?,?,?,?,?)')
      .run(org, email, hashPassword('password123'), name, role, title, avatar).lastInsertRowid;

  const admin = mk('admin@acme.com', 'Sara Admin', 'org_admin', 'People Ops Lead', '👑');
  const e1 = mk('layla@acme.com', 'Layla Hassan', 'employee', 'Frontend Engineer', '👩‍💻');
  const e2 = mk('omar@acme.com', 'Omar Khan', 'employee', 'Sales Associate', '🧑‍💼');
  const e3 = mk('noor@acme.com', 'Noor Ali', 'employee', 'Designer', '🎨');
  const e4 = mk('zaid@acme.com', 'Zaid Malik', 'employee', 'Support Specialist', '🎧');
  const e5 = mk('maya@acme.com', 'Maya Park', 'employee', 'Data Analyst', '📊');

  // ---- tasks ----
  const task = (title, desc, pts, assignee, status, priority) =>
    db
      .prepare(
        `INSERT INTO tasks (org_id, title, description, points, assigned_to, created_by, status, priority)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(org, title, desc, pts, assignee, admin, status, priority).lastInsertRowid;

  task('Write Q3 onboarding guide', 'Document the new hire onboarding flow.', 40, e1, 'in_progress', 'high');
  task('Close 5 support tickets', 'Clear the support backlog from last week.', 25, e4, 'submitted', 'medium');
  task('Design new landing hero', 'Refresh the marketing hero section.', 35, e3, 'completed', 'medium');
  task('Reach out to 10 leads', 'Cold outreach to qualified prospects.', 30, e2, 'in_progress', 'high');
  task('Build weekly metrics dashboard', 'Automate the weekly KPI report.', 50, null, 'open', 'medium');
  task('Plan team lunch', 'Organize the monthly team social.', 15, null, 'open', 'low');

  // approve the completed design task to give Noor points
  award(e3, 35, 'task', 'Task completed: Design new landing hero');
  db.prepare("UPDATE tasks SET completed_at=datetime('now') WHERE assigned_to=? AND status='completed'").run(e3);

  // ---- challenges ----
  const ch = (title, desc, pts, goal, unit) =>
    db
      .prepare(
        'INSERT INTO challenges (org_id, title, description, points, goal, unit) VALUES (?,?,?,?,?,?)'
      )
      .run(org, title, desc, pts, goal, unit).lastInsertRowid;

  const c1 = ch('30-Day Wellness Streak', 'Log a wellness activity every day.', 80, 30, 'days');
  const c2 = ch('Customer Love', 'Collect 20 positive customer mentions.', 60, 20, 'mentions');
  const c3 = ch('Learning Sprint', 'Finish 5 training modules this month.', 50, 5, 'modules');

  const joinProgress = (cid, uid, prog, goal, pts, title) => {
    const completed = prog >= goal ? 1 : 0;
    db.prepare(
      'INSERT INTO challenge_participants (challenge_id, user_id, progress, completed) VALUES (?,?,?,?)'
    ).run(cid, uid, prog, completed);
    if (completed) award(uid, pts, 'challenge', `Challenge completed: ${title}`);
  };
  joinProgress(c1, e1, 18, 30, 80, '30-Day Wellness Streak');
  joinProgress(c1, e5, 30, 30, 80, '30-Day Wellness Streak');
  joinProgress(c2, e2, 12, 20, 60, 'Customer Love');
  joinProgress(c3, e5, 5, 5, 50, 'Learning Sprint');
  joinProgress(c3, e1, 3, 5, 50, 'Learning Sprint');

  // ---- ideas ----
  const idea = (uid, title, desc, cat, status) =>
    db
      .prepare('INSERT INTO ideas (org_id, user_id, title, description, category, status) VALUES (?,?,?,?,?,?)')
      .run(org, uid, title, desc, cat, status).lastInsertRowid;

  const i1 = idea(e1, 'Four-day work week trial', 'Pilot a compressed work week for one quarter.', 'culture', 'under_review');
  const i2 = idea(e3, 'Standing desks for everyone', 'Healthier workspace, fewer back issues.', 'workplace', 'approved');
  const i3 = idea(e2, 'Referral bonus program', 'Reward employees who refer great hires.', 'hr', 'pending');
  const i4 = idea(e5, 'Internal hackathon', 'Quarterly day to build passion projects.', 'innovation', 'implemented');

  // approval rewards
  award(e3, 40, 'idea', 'Idea approved: Standing desks for everyone');
  award(e5, 100, 'idea', 'Idea implemented: Internal hackathon');
  // small submission rewards already implicit; add for the others
  award(e1, 5, 'idea', 'Submitted idea: Four-day work week trial');
  award(e2, 5, 'idea', 'Submitted idea: Referral bonus program');

  const vote = (iid, uid) => db.prepare('INSERT OR IGNORE INTO idea_votes (idea_id, user_id) VALUES (?,?)').run(iid, uid);
  [e1, e2, e3, e4, e5].forEach((u) => vote(i4, u));
  [e1, e2, e4].forEach((u) => vote(i1, u));
  [e3, e5].forEach((u) => vote(i2, u));
  [e1].forEach((u) => vote(i3, u));

  // ---- rewards catalog ----
  const reward = (title, desc, cost, icon, stock) =>
    db
      .prepare('INSERT INTO rewards (org_id, title, description, cost, icon, stock) VALUES (?,?,?,?,?,?)')
      .run(org, title, desc, cost, icon, stock).lastInsertRowid;

  reward('Free Pizza Lunch', 'A pizza on the house, delivered to your desk.', 80, '🍕', -1);
  reward('Coffee for a Week', 'Barista coffee every day for a week.', 60, '☕', -1);
  reward('Extra Day Off', 'One additional paid day off.', 500, '🏖️', 10);
  reward('Premium Hoodie', 'Limited-edition company hoodie.', 200, '🧥', 25);
  reward('$25 Gift Card', 'Redeem at your favorite store.', 250, '💳', -1);
  reward('Reserved Parking Spot', 'Best spot in the lot for a month.', 350, '🅿️', 3);
  reward('Lunch with the CEO', 'A one-on-one lunch with leadership.', 400, '🍽️', 5);

  // ---- a sample redemption ----
  const pizza = db.prepare("SELECT id, cost, title FROM rewards WHERE org_id=? AND title='Free Pizza Lunch'").get(org);
  award(e5, -pizza.cost, 'redemption', `Redeemed: ${pizza.title}`);
  db.prepare(
    'INSERT INTO redemptions (org_id, user_id, reward_id, reward_title, cost, status) VALUES (?,?,?,?,?,?)'
  ).run(org, e5, pizza.id, pizza.title, pizza.cost, 'pending');

  // give everyone a little baseline so the leaderboard looks alive
  award(e1, 60, 'bonus', 'Welcome bonus');
  award(e2, 35, 'bonus', 'Welcome bonus');
  award(e4, 20, 'bonus', 'Welcome bonus');

  // ============================================================
  // Project-management (Asana-style) demo data
  // ============================================================
  const PR = { none: 8, low: 6, medium: 12, high: 20 };
  const team = (name, icon, desc) => db.prepare('INSERT INTO teams (org_id,name,icon,description) VALUES (?,?,?,?)').run(org, name, icon, desc || '').lastInsertRowid;
  const tEng = team('Engineering', '⚙️', 'Builds the product');
  const tMkt = team('Marketing', '📣', 'Grows the brand');
  [admin, e1, e3, e5].forEach((u) => db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(tEng, u));
  [admin, e2, e3].forEach((u) => db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(tMkt, u));

  const project = (name, teamId, color, icon, view, desc, owner) =>
    db.prepare('INSERT INTO projects (org_id,team_id,name,description,color,icon,owner_id,default_view) VALUES (?,?,?,?,?,?,?,?)')
      .run(org, teamId, name, desc || '', color, icon, owner, view).lastInsertRowid;
  const section = (pid, name, pos) => db.prepare('INSERT INTO sections (project_id,name,position) VALUES (?,?,?)').run(pid, name, pos).lastInsertRowid;
  const member = (pid, uid, fav) => db.prepare('INSERT OR IGNORE INTO project_members (project_id,user_id,is_favorite) VALUES (?,?,?)').run(pid, uid, fav || 0);
  const pmtask = (pid, sid, name, opts = {}) => {
    const pr = opts.priority || 'none';
    const r = db.prepare(`INSERT INTO pm_tasks (org_id,project_id,section_id,name,notes,assignee_id,created_by,start_date,due_date,priority,is_milestone,points,completed,completed_at,position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(org, pid, sid, name, opts.notes || '', opts.assignee || null, admin, opts.start || null, opts.due || null, pr, opts.milestone ? 1 : 0, PR[pr], opts.completed ? 1 : 0, opts.completed ? new Date().toISOString() : null, opts.pos || 0);
    const id = r.lastInsertRowid;
    if (opts.assignee) { db.prepare('INSERT OR IGNORE INTO task_followers (task_id,user_id) VALUES (?,?)').run(id, opts.assignee); if (opts.completed) award(opts.assignee, PR[pr], 'task', `Completed: ${name}`), db.prepare('UPDATE pm_tasks SET awarded=1 WHERE id=?').run(id); }
    return id;
  };
  const subtask = (pid, parent, name, assignee, done) => db.prepare('INSERT INTO pm_tasks (org_id,project_id,parent_id,name,assignee_id,created_by,priority,points,completed) VALUES (?,?,?,?,?,?,?,?,?)').run(org, pid, parent, name, assignee || null, admin, 'none', PR.none, done ? 1 : 0).lastInsertRowid;
  const comment = (tid, uid, body) => db.prepare('INSERT INTO pm_comments (task_id,user_id,body) VALUES (?,?,?)').run(tid, uid, body).lastInsertRowid;
  const activity = (tid, uid, type, detail) => db.prepare('INSERT INTO pm_activity (task_id,user_id,type,detail) VALUES (?,?,?,?)').run(tid, uid, type, detail || '');

  // Project 1: Website Revamp (board)
  const p1 = project('Website Revamp', tEng, '#7c9bff', '🚀', 'board', 'Redesign and ship the new marketing website.', admin);
  [admin, e1, e3, e5].forEach((u, i) => member(p1, u, i === 0 ? 1 : 0));
  const p1s = ['To Do', 'In Progress', 'In Review', 'Done'].map((n, i) => section(p1, n, i));
  db.prepare("INSERT INTO custom_fields (project_id,name,type,options,position) VALUES (?,?,?,?,?)").run(p1, 'Effort', 'dropdown', JSON.stringify(['S', 'M', 'L', 'XL']), 0);
  const t1 = pmtask(p1, p1s[1], 'Design new homepage hero', { assignee: e3, priority: 'high', due: '2026-06-25', notes: 'Match the new brand guidelines.', milestone: false });
  subtask(p1, t1, 'Gather references', e3, true); subtask(p1, t1, 'Low-fi wireframe', e3, true); subtask(p1, t1, 'High-fi mockup', e3, false);
  comment(t1, admin, 'Looking great so far! Can we try a bolder headline? @noor'); comment(t1, e3, 'On it — pushing a v2 today.');
  activity(t1, admin, 'created', 'Design new homepage hero'); activity(t1, e3, 'comment', '');
  pmtask(p1, p1s[0], 'Set up analytics', { assignee: e1, priority: 'medium', due: '2026-06-30' });
  pmtask(p1, p1s[0], 'Write homepage copy', { assignee: e2, priority: 'medium', due: '2026-07-02' });
  pmtask(p1, p1s[1], 'Build responsive nav', { assignee: e1, priority: 'high', start: '2026-06-18', due: '2026-06-28' });
  pmtask(p1, p1s[2], 'QA cross-browser', { assignee: e5, priority: 'low', due: '2026-07-05' });
  pmtask(p1, p1s[3], 'Project kickoff', { assignee: admin, completed: true, priority: 'low', milestone: true });
  pmtask(p1, p1s[3], 'Domain & hosting ready', { assignee: e1, completed: true, priority: 'medium' });

  // Project 2: Q3 Product Launch (list)
  const p2 = project('Q3 Product Launch', tMkt, '#34e0ff', '📣', 'list', 'Coordinate the cross-functional Q3 launch.', e2);
  [admin, e2, e3, e5].forEach((u) => member(p2, u, 0));
  const p2s = ['Planning', 'Execution', 'Launch', 'Done'].map((n, i) => section(p2, n, i));
  pmtask(p2, p2s[0], 'Finalize launch date', { assignee: e2, priority: 'high', due: '2026-06-22', milestone: true });
  pmtask(p2, p2s[0], 'Press kit & assets', { assignee: e3, priority: 'medium', due: '2026-06-26' });
  pmtask(p2, p2s[1], 'Email campaign', { assignee: e2, priority: 'medium', due: '2026-07-01' });
  pmtask(p2, p2s[1], 'Social media schedule', { assignee: e5, priority: 'low', due: '2026-07-03' });
  pmtask(p2, p2s[2], 'Go live 🎉', { assignee: e2, priority: 'high', due: '2026-07-10', milestone: true });

  // Project 3: Customer Support Ops (board) with a rule + form
  const p3 = project('Support Ops', tEng, '#2ce6a8', '🎧', 'board', 'Track and resolve customer issues.', e4);
  [admin, e4, e1].forEach((u) => member(p3, u, 0));
  const p3s = ['New', 'Investigating', 'Resolved'].map((n, i) => section(p3, n, i));
  pmtask(p3, p3s[0], 'Login bug on Safari', { assignee: e4, priority: 'high', due: '2026-06-21' });
  pmtask(p3, p3s[1], 'Billing export slow', { assignee: e1, priority: 'medium' });
  pmtask(p3, p3s[2], 'Password reset email', { assignee: e4, completed: true, priority: 'low' });
  db.prepare('INSERT INTO rules (project_id,name,trigger_type,trigger_value,action_type,action_value) VALUES (?,?,?,?,?,?)').run(p3, 'Auto-assign new tickets', 'task_added', '', 'set_assignee', String(e4));
  db.prepare("UPDATE projects SET form_enabled=1, form_title=?, form_fields=? WHERE id=?").run('Report an issue', JSON.stringify(['Steps to reproduce', 'Severity']), p3);

  // Tags
  const tag = (n, c) => db.prepare('INSERT INTO tags (org_id,name,color) VALUES (?,?,?)').run(org, n, c).lastInsertRowid;
  const tagBug = tag('bug', '#ff5d73'), tagFeat = tag('feature', '#7c9bff'), tagUrgent = tag('urgent', '#ffab2e'), tagDesign = tag('design', '#b56bff');
  db.prepare('INSERT OR IGNORE INTO task_tags (task_id,tag_id) VALUES (?,?)').run(t1, tagDesign);
  db.prepare('INSERT OR IGNORE INTO task_tags (task_id,tag_id) VALUES (?,?)').run(t1, tagUrgent);

  // Portfolio
  const pf = db.prepare('INSERT INTO portfolios (org_id,name,description,owner_id,color) VALUES (?,?,?,?,?)').run(org, 'Company OKRs 2026', 'All strategic initiatives', admin, '#34e0ff').lastInsertRowid;
  [p1, p2].forEach((pid) => db.prepare('INSERT OR IGNORE INTO portfolio_projects (portfolio_id,project_id) VALUES (?,?)').run(pf, pid));

  // Goals
  const goal = (name, owner, status, prog, due) => db.prepare('INSERT INTO goals (org_id,name,owner_id,status,progress,due_date) VALUES (?,?,?,?,?,?)').run(org, name, owner, status, prog, due).lastInsertRowid;
  const g1 = goal('Grow MRR to $100k', admin, 'on_track', 65, '2026-09-30');
  const g2 = goal('Launch v2 of the product', e2, 'at_risk', 40, '2026-07-31');
  goal('Improve CSAT to 95%', e4, 'on_track', 80, '2026-08-15');
  db.prepare('INSERT OR IGNORE INTO goal_projects (goal_id,project_id) VALUES (?,?)').run(g2, p2);
  db.prepare('INSERT OR IGNORE INTO goal_projects (goal_id,project_id) VALUES (?,?)').run(g1, p1);

  // A couple of status updates + notifications already created via comments above
  db.prepare('INSERT INTO status_updates (project_id,user_id,status,title,body) VALUES (?,?,?,?,?)').run(p1, admin, 'on_track', 'Week 1 going strong', 'Design is ahead of schedule, engineering ramping up.');
  db.prepare('INSERT INTO status_updates (project_id,user_id,status,title,body) VALUES (?,?,?,?,?)').run(p2, e2, 'at_risk', 'Waiting on assets', 'Launch date may slip if press kit is late.');

  // Seed inbox notifications for a few users
  db.prepare('INSERT INTO notifications (org_id,user_id,actor_id,type,task_id,project_id,text) VALUES (?,?,?,?,?,?,?)').run(org, e3, admin, 'mention', t1, p1, 'mentioned you on "Design new homepage hero"');
  db.prepare('INSERT INTO notifications (org_id,user_id,actor_id,type,task_id,project_id,text) VALUES (?,?,?,?,?,?,?)').run(org, e1, admin, 'assigned', null, p1, 'assigned you "Build responsive nav"');

  console.log('Seed complete.');
  console.log('--------------------------------------------------');
  console.log('SUPER ADMIN (you):');
  console.log(`  ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  console.log('ORG ADMIN (Acme Innovations):');
  console.log('  admin@acme.com / password123');
  console.log('EMPLOYEES (Acme Innovations):');
  console.log('  layla@acme.com / password123');
  console.log('  omar@acme.com  / password123');
  console.log('  maya@acme.com  / password123  (top of leaderboard)');
  console.log('--------------------------------------------------');
}

run();
