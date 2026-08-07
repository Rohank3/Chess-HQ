# Chess-HQ

Real-time multiplayer chess with Elo-based matchmaking, server-authoritative move validation,
a synchronized chess clock, and a polished dark-mode UI.

## Stack

- **Frontend:** React 19, Vite 6, Tailwind v4, react-chessboard v5, react-router v6.
- **Backend:** Node.js, Express 5, Socket.IO v4, chess.js (server-authoritative game logic).
- **Auth:** Argon2id password hashing (`@node-rs/argon2`), JWT access tokens.
- **Database:** PostgreSQL via `pg` (connection pool singleton).
- **Deploy:** Netlify (frontend) + Render with Render Postgres (backend).

## Repository layout

```
.
├─ ARCHITECTURE.md   the "why" behind every decision (read this for interview prep)
├─ client/           React + Vite frontend
└─ server/           Express + Socket.IO backend
```

## Local development

```bash
# install root + workspace deps
npm run install:all

# server env (copy and fill in)
cp server/.env.example server/.env

# start both workspaces concurrently
npm run dev
```

The client runs on http://localhost:5173 and proxies `/api` + `/socket.io` to the
backend on http://localhost:4000.

## Documentation

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full architecture and per-step engineering
rationale. The code itself is intentionally comment-light; the reasoning lives in that file.

## License

MIT.
