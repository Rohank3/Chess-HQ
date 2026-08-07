# Chess-HQ

Real-time multiplayer chess with Elo-based matchmaking, server-authoritative move validation,
a synchronized chess clock, and a polished dark-mode UI.

## Stack

- **Frontend:** React 19, Vite 6, Tailwind v4, react-chessboard v5, react-router v6.
- **Backend:** Node.js, Express 5, Socket.IO v4, chess.js (server-authoritative game logic).
- **Auth:** Argon2id password hashing (`@node-rs/argon2`), JWT access tokens.
- **Database:** PostgreSQL via `pg` (connection pool singleton, transactional migrations).
- **Deploy:** Netlify (frontend) + Render with Render Postgres (backend).

## Repository layout

```
.
├─ client/                  React + Vite frontend
├─ server/                 Express + Socket.IO backend
│  └─ src/db/migrations/   forward-only SQL migrations applied via `npm run db:migrate`
└─ ARCHITECTURE.md         (local-only) the "why" behind every decision
```

## Prerequisites

- Node.js 20.11+ (we develop on Node 24).
- A reachable PostgreSQL instance (Render Postgres in prod, or any local/Docker Postgres in dev).

## Local development

```bash
# install root + workspace deps
npm run install:all

# server env
cp server/.env.example server/.env
# edit server/.env: set DATABASE_URL to your local Postgres

# apply database migrations
npm --prefix server run db:migrate

# start both workspaces concurrently
npm run dev
```

The client runs on http://localhost:5173 and proxies `/api` + `/socket.io` to the
backend on http://localhost:4000.

### Migrations

Migrations are idempotent SQL files in `server/src/db/migrations/`, named in load order
(`001_init.sql`, `002_*.sql`, ...). Each file is wrapped in a single transaction by the
runner in `server/src/db/migrate.ts`; the runner records applied migrations in a
`_migrations` table so re-runs skip already-applied files.

```bash
npm --prefix server run db:migrate          # apply pending
npm --prefix server run db:migrate:dry-run  # list pending without applying
```

Migrations are NOT auto-applied at server boot. They run as an explicit deploy/release
step (documented in step 11) so a flapping deploy can never lock migrations or partly
mutate the schema.

## Documentation

See `ARCHITECTURE.md` (kept local-only) for the full architecture and per-step engineering
rationale. The code itself is intentionally comment-light; the reasoning lives in that file.

## License

MIT.
