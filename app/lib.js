'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'starboard-dev-secret-change-me';
const TOKEN_TTL = '7d';

// ---- auth helpers ----
function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
function checkPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, org_id: user.org_id },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ---- gamification ----
// Level curve: level N requires 100*N cumulative points (triangular-ish, simple & legible).
function levelFor(points) {
  let level = 1;
  let needed = 100;
  let remaining = points;
  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed = 100 * level;
  }
  return {
    level,
    intoLevel: remaining,
    forNext: needed,
    progress: Math.round((remaining / needed) * 100),
  };
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'org';

function uniqueSlug(base) {
  let slug = slugify(base);
  let i = 1;
  while (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) {
    slug = `${slugify(base)}-${i++}`;
  }
  return slug;
}

// Award points + stars to a user inside a transaction. Returns updated user.
const _award = db.transaction((userId, amount, kind, reason) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('user not found');
  const newPoints = user.points + (amount > 0 ? amount : 0);
  const newStars = Math.max(0, user.stars + amount);
  db.prepare('UPDATE users SET points = ?, stars = ? WHERE id = ?').run(
    newPoints,
    newStars,
    userId
  );
  db.prepare(
    'INSERT INTO transactions (org_id, user_id, amount, kind, reason) VALUES (?,?,?,?,?)'
  ).run(user.org_id, userId, amount, kind, reason || '');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
});

function award(userId, amount, kind, reason) {
  return _award(userId, amount, kind, reason);
}

// ---- badges (computed on the fly) ----
function badgesFor(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return [];
  const tasksDone = db
    .prepare("SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND status = 'completed'")
    .get(userId).c;
  const ideas = db.prepare('SELECT COUNT(*) c FROM ideas WHERE user_id = ?').get(userId).c;
  const ideasApproved = db
    .prepare("SELECT COUNT(*) c FROM ideas WHERE user_id = ? AND status IN ('approved','implemented')")
    .get(userId).c;
  const challengesDone = db
    .prepare('SELECT COUNT(*) c FROM challenge_participants WHERE user_id = ? AND completed = 1')
    .get(userId).c;
  const { level } = levelFor(u.points);

  const rank =
    u.org_id == null
      ? null
      : db
          .prepare('SELECT COUNT(*) c FROM users WHERE org_id = ? AND role = ? AND points > ?')
          .get(u.org_id, 'employee', u.points).c + 1;

  const all = [
    { id: 'rookie', icon: '🌱', name: 'Rookie', desc: 'Joined the team', earned: true },
    { id: 'first_task', icon: '✅', name: 'Go-Getter', desc: 'Completed your first task', earned: tasksDone >= 1 },
    { id: 'task_master', icon: '🏅', name: 'Task Master', desc: 'Completed 10 tasks', earned: tasksDone >= 10 },
    { id: 'idea_spark', icon: '💡', name: 'Idea Spark', desc: 'Submitted an idea', earned: ideas >= 1 },
    { id: 'innovator', icon: '🚀', name: 'Innovator', desc: 'Had an idea approved', earned: ideasApproved >= 1 },
    { id: 'challenger', icon: '🔥', name: 'Challenger', desc: 'Finished a challenge', earned: challengesDone >= 1 },
    { id: 'level5', icon: '⭐', name: 'Rising Star', desc: 'Reached level 5', earned: level >= 5 },
    { id: 'level10', icon: '👑', name: 'Legend', desc: 'Reached level 10', earned: level >= 10 },
    { id: 'podium', icon: '🥇', name: 'Podium', desc: 'Top 3 on the leaderboard', earned: rank != null && rank <= 3 },
  ];
  return all;
}

function publicUser(u) {
  if (!u) return null;
  const lvl = levelFor(u.points);
  return {
    id: u.id,
    org_id: u.org_id,
    email: u.email,
    name: u.name,
    role: u.role,
    title: u.title,
    avatar: u.avatar || '🙂',
    points: u.points,
    stars: u.stars,
    status: u.status,
    level: lvl.level,
    levelProgress: lvl.progress,
    intoLevel: lvl.intoLevel,
    forNext: lvl.forNext,
    created_at: u.created_at,
  };
}

module.exports = {
  db,
  JWT_SECRET,
  hashPassword,
  checkPassword,
  signToken,
  verifyToken,
  levelFor,
  slugify,
  uniqueSlug,
  award,
  badgesFor,
  publicUser,
};
