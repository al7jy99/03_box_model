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

// ============================================================
// Project-management layer (Asana-style work management)
// ============================================================
function initPM() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon        TEXT DEFAULT '👥',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    color        TEXT DEFAULT '#7c9bff',
    icon         TEXT DEFAULT '📁',
    owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'on_track',   -- on_track | at_risk | off_track | on_hold | complete
    privacy      TEXT NOT NULL DEFAULT 'team',        -- team | private | public
    default_view TEXT NOT NULL DEFAULT 'board',       -- list | board | calendar | timeline | dashboard | overview
    is_archived  INTEGER NOT NULL DEFAULT 0,
    is_template  INTEGER NOT NULL DEFAULT 0,
    form_enabled INTEGER NOT NULL DEFAULT 0,
    form_title   TEXT DEFAULT 'Submit a request',
    form_fields  TEXT DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pm_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    section_id   INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    parent_id    INTEGER REFERENCES pm_tasks(id) ON DELETE CASCADE,  -- subtask parent
    name         TEXT NOT NULL,
    notes        TEXT DEFAULT '',
    assignee_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    start_date   TEXT,
    due_date     TEXT,
    completed    INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    priority     TEXT NOT NULL DEFAULT 'none',        -- none | low | medium | high
    is_milestone INTEGER NOT NULL DEFAULT 0,
    recurrence   TEXT NOT NULL DEFAULT 'none',         -- none | daily | weekly | monthly
    points       INTEGER NOT NULL DEFAULT 10,
    awarded      INTEGER NOT NULL DEFAULT 0,           -- gamification: points already granted
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_followers (
    task_id INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(task_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id          INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    blocked_by       INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, blocked_by)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name   TEXT NOT NULL,
    color  TEXT DEFAULT '#b56bff'
  );
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    UNIQUE(task_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS pm_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pm_likes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL,   -- task | comment
    target_id   INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(target_type, target_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    url        TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_fields (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'text',  -- text | number | dropdown
    options    TEXT DEFAULT '[]',
    position   INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS custom_field_values (
    task_id  INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value    TEXT DEFAULT '',
    UNIQUE(task_id, field_id)
  );

  CREATE TABLE IF NOT EXISTS pm_activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type       TEXT NOT NULL,   -- assigned | mention | comment | due_soon | completed | follow | status
    task_id    INTEGER REFERENCES pm_tasks(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    text       TEXT DEFAULT '',
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS status_updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status     TEXT NOT NULL DEFAULT 'on_track',
    title      TEXT DEFAULT '',
    body       TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS portfolios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    color       TEXT DEFAULT '#34e0ff',
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS portfolio_projects (
    portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(portfolio_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'on_track',  -- on_track | at_risk | off_track | achieved | no_status
    progress    INTEGER NOT NULL DEFAULT 0,
    due_date    TEXT,
    parent_id   INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS goal_projects (
    goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(goal_id, project_id)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    trigger_type  TEXT NOT NULL,   -- task_added | completed | assignee_set | moved_section
    trigger_value TEXT DEFAULT '',
    action_type   TEXT NOT NULL,   -- set_assignee | move_section | set_priority | add_comment | add_follower
    action_value  TEXT DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_projects (
    task_id    INTEGER NOT NULL REFERENCES pm_tasks(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
    UNIQUE(task_id, project_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pmtasks_project ON pm_tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_pmtasks_assignee ON pm_tasks(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_pmtasks_parent ON pm_tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);
  CREATE INDEX IF NOT EXISTS idx_taskprojects ON task_projects(project_id);
  `);

  // ---- additive migrations (safe to run repeatedly) ----
  const cols = db.prepare("PRAGMA table_info(attachments)").all().map((c) => c.name);
  const addCol = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE attachments ADD COLUMN ${name} ${def}`); };
  addCol('kind', "TEXT NOT NULL DEFAULT 'link'");   // link | file
  addCol('path', "TEXT DEFAULT ''");                 // stored file path (for kind=file)
  addCol('size', 'INTEGER DEFAULT 0');
  addCol('mime', "TEXT DEFAULT ''");
}

init();
initPM();

module.exports = db;
