# Chess-HQ

Real-time multiplayer chess with Elo-based matchmaking, server-authoritative move validation,
a synchronized chess clock, and a polished dark-mode UI. The server is the source of truth
for move legality, the clock, and game termination; the client is a non-authoritative view
that renders state pushed over Socket.IO and optimistically reconciles its own moves.

## Stack

- **Frontend:** React 19, Vite 6, Tailwind v4, react-chessboard v5, react-router v6.
- **Backend:** Node.js, Express 5, Socket.IO v4, chess.js (server-authoritative game logic).
- **Auth:** Argon2id password hashing (`@node-rs/argon2`), JWT access tokens.
- **Database:** PostgreSQL via the `pg` driver (connection pool singleton, transactional
  forward-only SQL migrations).
- **Deploy:** Netlify (frontend SPA) + Render web service with Render Postgres (backend).

## Repository layout

```
.
├─ client/                 React + Vite frontend
│  ├─ netlify.toml         build command, publish dir, SPA redirect
│  └─ src/
├─ server/                 Express + Socket.IO backend
│  ├─ src/db/migrations/   forward-only SQL migrations applied via `npm run db:migrate`
│  └─ src/
├─ render.yaml             Render Blueprint (web service + Postgres, at repo root)
└─ package.json            script-only root (no workspace hoisting)
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
# edit server/.env: set DATABASE_URL to your local Postgres and JWT_SECRET to
# `openssl rand -hex 32`

# apply database migrations
npm --prefix server run db:migrate

# start both workspaces concurrently
npm run dev
```

The client runs on http://localhost:5173 and proxies `/api` + `/socket.io` to the backend on
http://localhost:4000 via the Vite dev proxy (`client/vite.config.ts`). In dev the
`VITE_API_URL` / `VITE_SOCKET_URL` vars can stay empty so requests are relative and the proxy
forwards them.

## Environment

### Server (`server/.env` — copy from `server/.env.example`)

| Variable               | Default                 | Required | Notes                                                                            |
| ---------------------- | ----------------------- | -------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`           | no       | `production` skips `.env` loading; Render sets it.                               |
| `PORT`                 | `4000`                  | no       | listen port.                                                                     |
| `DATABASE_URL`         | —                       | **yes**  | a valid `postgresql://` URL; injected from the Render DB in prod.                |
| `JWT_SECRET`           | —                       | **yes**  | HS256 signing secret, ≥32 chars (`openssl rand -hex 32`). Render: `sync: false`. |
| `JWT_ACCESS_TTL`       | `15m`                   | no       | access token TTL.                                                                |
| `JWT_GUEST_TTL`        | `2h`                    | no       | shorter guest token TTL (use-and-discard).                                       |
| `CLIENT_ORIGIN`        | `http://localhost:5173` | no       | the browser origin; drives HTTP + Socket.IO CORS and Helmet CSP `connectSrc`.    |
| `RATE_LIMIT_WINDOW_MS` | `60000`                 | no       | per-bucket window.                                                               |
| `RATE_LIMIT_MAX`       | `60`                    | no       | requests per window per IP. Auth routes use tighter per-scope overrides.         |
| `LOG_LEVEL`            | `info`                  | no       | structured JSON logging level.                                                   |
| `DRAW_OFFER_TTL_MS`    | `30000`                 | no       | stale draw-offer reaper window.                                                  |
| `MAX_ILLEGAL_MOVES`    | `5`                     | no       | per-socket illegal-move disconnect threshold.                                    |
| `TRUST_PROXY_HOPS`     | `0`                     | no       | Express `trust proxy`. Render sets `1` so `req.ip` reads the real client.        |

### Client (`client/.env.production.example`)

Two build-time Vite vars, baked into the bundle by `vite build`. Set them in the Netlify
dashboard (Site settings → Environment variables), **not** in a committed env file:

| Variable          | Consumed by               | Notes                                                              |
| ----------------- | ------------------------- | ------------------------------------------------------------------ |
| `VITE_API_URL`    | `src/api/http.ts` (axios) | Render backend HTTPS origin. Empty in dev (Vite proxy handles it). |
| `VITE_SOCKET_URL` | `src/socket/socket.ts`    | Render backend HTTPS origin (same as `VITE_API_URL`).              |

## Migrations

Migrations are idempotent SQL files in `server/src/db/migrations/`, named in load order
(`001_init.sql`, `002_*.sql`, …). Each file is wrapped in a single transaction by the runner in
`server/src/db/migrate.ts`; the runner records applied migrations in a `_migrations` table so
re-runs skip already-applied files. A failed file rolls back its own transaction and stops the
run — a deploy never partly mutates the schema.

```bash
npm --prefix server run db:migrate           # apply pending
npm --prefix server run db:migrate:dry-run   # list pending without applying
```

Migrations run as an explicit `npm run db:migrate` step, never from application code. On
Render it is folded into the start command (`db:migrate && node dist/index.js`) because the
free tier does not support pre-deploy/release commands. The runner is idempotent and
transactional, so a flapping deploy can never lock migrations or partly mutate the schema.

## Deployment

The app is a single-instance topology by design:

- **Backend — Render.** `render.yaml` (repo root) is a Render Blueprint that provisions a managed
  Render Postgres database (`chess-db`) and a Node web service (`chess-server`). Migrations
  run at container start (`db:migrate && node dist/index.js`) because the free tier does not
  support pre-deploy/release commands; the runner is idempotent, so unchanged schema is a
  no-op. `DATABASE_URL` is injected from the database resource; `JWT_SECRET` and
  `CLIENT_ORIGIN` are `sync: false` secrets you paste into the Render dashboard.
  `TRUST_PROXY_HOPS=1` is set so `req.ip` reads the real client through Render's one trusted
  proxy (which the per-IP rate limiter keys on). The DB-aware `GET /api/health` is the
  service's health check.
- **Frontend — Netlify.** `client/netlify.toml` runs `npm run build`, publishes `dist/`, and
  rewrites `/*` to `/index.html` with status `200` so `createBrowserRouter` deep links resolve.
  Set `VITE_API_URL` / `VITE_SOCKET_URL` in the Netlify dashboard (from
  `client/.env.production.example`) to the Render backend's HTTPS origin — they're build-time
  values baked into the bundle.

### Why single instance

The in-memory rate-limit buckets (`server/src/security/rate-limit.ts`) and the in-memory
Socket.IO lobby + matchmaking queue (`server/src/sockets/`) are per-process. Scaling
horizontally would fragment rate-limit buckets across instances and break the matchmaking
queue's single-process global view. A Socket.IO Redis adapter plus a shared matchmaking queue
is the (deferred) horizontal-scale path; the current topology deliberately stays single-instance
until that work is taken on.

## Scripts

### Root

| Script         | What it does                                                    |
| -------------- | --------------------------------------------------------------- |
| `dev`          | run both workspaces concurrently (`dev:server` + `dev:client`). |
| `dev:server`   | `npm --prefix server run dev` (tsx watch).                      |
| `dev:client`   | `npm --prefix client run dev` (Vite on :5173).                  |
| `install:all`  | `npm install` in both workspaces.                               |
| `format`       | prettier --write across the repo.                               |
| `format:check` | prettier --check across the repo (CI guard).                    |

### Server (`npm --prefix server run <script>`)

| Script               | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `dev`                | tsx watch `src/index.ts`.                                        |
| `build`              | `tsc -p tsconfig.json` (emit to `dist/`).                        |
| `start`              | `node dist/index.js`.                                            |
| `typecheck`          | `tsc --noEmit` on both the app and test configs (no emit).       |
| `test`               | `node --test` over 8 test files under the `test-env.ts` sandbox. |
| `db:migrate`         | apply pending migrations.                                        |
| `db:migrate:dry-run` | list pending without applying.                                   |

### Client (`npm --prefix client run <script>`)

| Script      | What it does                                                      |
| ----------- | ----------------------------------------------------------------- |
| `dev`       | Vite on :5173 (strict port) with the `/api` + `/socket.io` proxy. |
| `build`     | `tsc -b && vite build` (type-check then write `dist/`).           |
| `preview`   | serve the built `dist/` on :5173.                                 |
| `typecheck` | `tsc -b --noEmit`.                                                |

## Testing

- **Server unit tests:** `npm --prefix server run test` — Node's built-in `--test` runner over
  8 files (auth, jwt, refresh, validation, argon, matchmaking, elo, clock, migrate). Tests run
  under `server/src/config/test-env.ts`, which seeds a non-production sandbox env and a
  placeholder `DATABASE_URL` — **no live PostgreSQL is required**. Assertions cover the pure
  stateless properties (token signing/verification, Elo math, clock arithmetic, the migration
  runner's idempotency and transaction framing).
- **Client type-check + build:** `npm --prefix client run typecheck` and `npm --prefix client
run build` (`tsc -b && vite build`).
- **Live-DB end-to-end flows** (two browsers play a game, the watchdog fires, a bot socket hits
  `MAX_ILLEGAL_MOVES`, a refresh rides a 15-minute token boundary) require a live Render +
  Postgres environment and are deferred — consistent with the deferral discipline across each
  build step.
