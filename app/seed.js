'use strict';

// Seeds the platform with a super admin and a demo organization full of data.
// Safe to re-run: it clears existing data first.

const { db, hashPassword, award } = require('./lib');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'abdullah.alhejji99@gmail.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'super1234';

function reset() {
  const tables = [
    'transactions', 'redemptions', 'rewards', 'idea_votes', 'ideas',
    'challenge_participants', 'challenges', 'tasks', 'users', 'organizations',
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
