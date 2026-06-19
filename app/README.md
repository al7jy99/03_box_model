# ⭐ StarBoard — Employee Gamification SaaS

A complete, multi-tenant SaaS platform that gamifies the workplace. Employees
earn **points** (XP) and spendable **stars** by completing tasks, finishing
challenges, and submitting ideas — then redeem their stars for real rewards
like free pizza, gift cards, or an extra day off.

It ships with three fully working portals:

| Portal | Who | What they do |
| --- | --- | --- |
| **Super Admin** | You (platform owner) | Provision customer organizations, manage plans/seats, suspend or delete tenants, see platform-wide stats. |
| **Org Admin** | Each organization's manager | Manage members, create & approve tasks, run challenges, review ideas, build the rewards catalog, fulfil redemptions, award points, view analytics & leaderboard. |
| **Employee** | Organization users | Claim/complete tasks, join challenges, submit & upvote ideas, redeem stars in the rewards shop, track level/badges/rank. |

## Features

- **Multi-tenancy** — every organization is isolated; data never leaks between tenants. Self-serve signup creates a new org + its first admin.
- **Task tracking** — open/claim/submit/approve workflow. Approving a task awards the assignee points + stars.
- **Challenges** — team challenges with progress goals; auto-rewards on completion.
- **Idea box** — employees submit ideas, everyone upvotes, admins move them through `pending → under review → approved → implemented`. Approved/implemented ideas pay bonus stars.
- **Rewards & redemptions** — admins define a catalog (cost in stars, stock, icon). Employees redeem; stars are deducted immediately and refunded automatically if a request is rejected.
- **Gamification** — points vs. spendable stars, levels with an XP curve, a live leaderboard, and computed achievement badges.
- **Game-like experience** — a playful arcade UI with an animated starfield, rounded game fonts, chunky 3D buttons, glassmorphism, confetti bursts, floating "+XP" pops, full-screen level-up / reward celebrations, animated count-up stats, and optional sound effects (synthesized in the browser, with a mute toggle).

## Work management (Asana-style)

A full project-management layer is built in and integrates with the gamification
(completing real work awards stars). Backend lives in `pm.js` (64 REST endpoints
under `/api/pm`), schema in `db.js`.

- **Teams** — group people; projects belong to a team.
- **Projects** — color/icon, owner, members, privacy, archive, favorites, status, project templates (Kanban / Sprint / Editorial / Blank).
- **Six project views** — **Overview**, **Board** (Kanban by section), **List**, **Calendar**, **Timeline** (Gantt-style bars), and **Dashboard** (charts).
- **Sections** — group tasks within a project.
- **Tasks** — assignee, start/due dates, priority, notes, milestones, tags, recurrence (daily/weekly/monthly).
- **Subtasks**, **dependencies** (a task can't complete while blockers are open), **collaborators/followers**.
- **Comments** with **@mentions** (drive notifications) and **likes/hearts** on tasks and comments.
- **Custom fields** (text / number / dropdown) per project.
- **Tags**, **attachments** (links), and a per-task **activity log**.
- **My Tasks** — your work across all projects, bucketed by Overdue / Today / Next 7 days / Later / No date / Completed.
- **Inbox** — notifications for assignments, mentions, comments, completions, status updates (with unread badge).
- **Goals** — objectives with progress, status, owner and linked projects.
- **Portfolios** — group projects with roll-up progress.
- **Status updates** per project; **Workload** (capacity per person); **Reporting** dashboards (completion rate, by priority/project/assignee, 7-day trend).
- **Rules / automation** — "when *trigger* → do *action*" (auto-assign, move section, set priority, add comment/collaborator).
- **Forms** — intake forms that turn submissions into tasks.
- **Global search** across tasks and projects.
- **Auth & security** — bcrypt password hashing, JWT sessions, role-based access control on every endpoint.

## Tech stack

- **Backend:** Node.js + Express, SQLite (`better-sqlite3`), JWT, bcrypt — no external services required.
- **Frontend:** Dependency-free single-page app (vanilla JS) served by the API. No build step.

## Run it

```bash
cd app
npm install
npm run seed     # creates the database + demo data (re-runnable)
npm start        # http://localhost:3000
npm test         # optional: headless smoke test of every screen
```

Then open <http://localhost:3000>.

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| 🛡️ Super admin | `abdullah.alhejji99@gmail.com` | `super1234` |
| 👑 Org admin (Acme Innovations) | `admin@acme.com` | `password123` |
| 📊 Employee (top of leaderboard) | `maya@acme.com` | `password123` |
| 👩‍💻 Employee | `layla@acme.com` | `password123` |
| 🧑‍💼 Employee | `omar@acme.com` | `password123` |

You can also click **"Create organization"** on the login screen to spin up a
brand-new tenant from scratch.

## Configuration

Environment variables (all optional):

- `PORT` — server port (default `3000`)
- `JWT_SECRET` — token signing secret (set this in production)
- `DB_PATH` — SQLite file path (default `app/data/starboard.db`)
- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` — credentials created by the seed

## API overview

All endpoints live under `/api`. Auth is a `Bearer` JWT from `/api/auth/login`
or `/api/auth/signup`. Highlights:

- `POST /api/auth/login` · `POST /api/auth/signup` · `GET /api/auth/me`
- `GET/POST/PATCH/DELETE /api/super/orgs` · `GET /api/super/stats` *(super admin)*
- `GET/POST/PATCH/DELETE /api/members` · `POST /api/members/:id/award`
- `GET/POST/PATCH/DELETE /api/tasks` · `/api/tasks/:id/{claim,submit,approve,reject}`
- `GET/POST/PATCH/DELETE /api/challenges` · `/api/challenges/:id/{join,progress}`
- `GET/POST /api/ideas` · `/api/ideas/:id/vote` · `PATCH /api/ideas/:id` *(status)*
- `GET/POST/PATCH/DELETE /api/rewards` · `POST /api/rewards/:id/redeem`
- `GET/PATCH /api/redemptions` · `GET /api/leaderboard` · `GET /api/analytics`
- `GET/PATCH /api/me/profile`
