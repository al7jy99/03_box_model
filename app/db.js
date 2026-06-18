'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'starboard.db');

const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    plan        TEXT NOT NULL DEFAULT 'free',
    status      TEXT NOT NULL DEFAULT 'active',     -- active | suspended
    seats       INTEGER NOT NULL DEFAULT 25,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL,                    -- super_admin | org_admin | employee
    title         TEXT DEFAULT '',
    avatar        TEXT DEFAULT '',                  -- emoji
    points        INTEGER NOT NULL DEFAULT 0,       -- lifetime XP (leaderboard/level)
    stars         INTEGER NOT NULL DEFAULT 0,       -- spendable balance
    status        TEXT NOT NULL DEFAULT 'active',   -- active | disabled
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    points       INTEGER NOT NULL DEFAULT 10,
    assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'open',      -- open | in_progress | submitted | completed
    priority     TEXT NOT NULL DEFAULT 'medium',    -- low | medium | high
    due_date     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    points       INTEGER NOT NULL DEFAULT 50,
    goal         INTEGER NOT NULL DEFAULT 1,        -- units required to complete
    unit         TEXT DEFAULT 'steps',
    start_date   TEXT,
    end_date     TEXT,
    status       TEXT NOT NULL DEFAULT 'active',    -- active | archived
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS challenge_participants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    progress     INTEGER NOT NULL DEFAULT 0,
    completed    INTEGER NOT NULL DEFAULT 0,
    joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(challenge_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ideas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    category     TEXT DEFAULT 'general',
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | under_review | approved | implemented | rejected
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS idea_votes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id  INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(idea_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    cost         INTEGER NOT NULL DEFAULT 100,
    icon         TEXT DEFAULT '🎁',
    stock        INTEGER NOT NULL DEFAULT -1,       -- -1 = unlimited
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id    INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
    reward_title TEXT NOT NULL,
    cost         INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | fulfilled | rejected
    note         TEXT DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      INTEGER NOT NULL,                   -- + earn, - spend
    kind        TEXT NOT NULL,                      -- task | challenge | idea | redemption | manual | bonus
    reason      TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_org   ON users(org_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_org   ON tasks(org_id);
  CREATE INDEX IF NOT EXISTS idx_ideas_org   ON ideas(org_id);
  CREATE INDEX IF NOT EXISTS idx_tx_user     ON transactions(user_id);
  `);
}

init();

module.exports = db;
