# Architecture — Chess-HQ

A real-time multiplayer chess web application. This document is the canonical explanation of
**why every engineering decision was made**, kept separate from the code so the codebase stays
annotation-free and reviewable. Each build step appends a section.

---

## Table of Contents

- [Step 1 — Monorepo scaffold, tooling, env validation](#step-1--monorepo-scaffold-tooling-env-validation)
  - [Repo layout](#repo-layout)
  - [Why a script-only root package.json](#why-a-script-only-root-packagejson)
  - [Server language, runtime, and module system](#server-language-runtime-and-module-system)
  - [TypeScript strictness](#typescript-strictness)
  - [Environment validation with zod](#environment-validation-with-zod)
  - [Structured logging](#structured-logging)
  - [Express 5 security middleware ordering](#express-5-security-middleware-ordering)
  - [Typed request augmentation for `req.id` and `req.user`](#typed-request-augmentation-for-reqid-and-requser)
  - [HTTP error contract](#http-error-contract)
  - [Frontend toolchain — Vite, React 19, Tailwind v4](#frontend-toolchain--vite-react-19-tailwind-v4)
  - [Dark-mode-first theme strategy](#dark-mode-first-theme-strategy)
  - [Dev proxy so a single origin serves the browser](#dev-proxy-so-a-single-origin-serves-the-browser)
  - [Verified third-party API surface](#verified-third-party-api-surface)

---

## Step 1 — Monorepo scaffold, tooling, env validation

### Repo layout

```
.
├─ .gitignore
├─ .editorconfig
├─ .prettierrc.json
├─ .prettierignore
├─ ARCHITECTURE.md            this file; appended after every step
├─ LICENSE                    MIT
├─ package.json               root: dev orchestration + prettier only
├─ client/                    React 19 + Vite + Tailwind v4 frontend
│  ├─ index.html
│  ├─ package.json
│  ├─ tsconfig.json tsconfig.app.json tsconfig.node.json
│  ├─ vite.config.ts
│  └─ src/
│     ├─ main.tsx App.tsx
│     ├─ env.d.ts              vite/client reference
│     ├─ pages/{Landing,NotFound}.tsx
│     └─ styles/theme.css      Tailwind v4 entry + design tokens
└─ server/                    Express 5 + Socket.IO + Postgres backend
   ├─ package.json
   ├─ tsconfig.json
   ├─ .env.example
   └─ src/
      ├─ index.ts              httpServer wiring
      ├─ config/env.ts         zod-validated env + dotenv loader
      ├─ routes/health.ts      health-check route
      ├─ types/express.d.ts    ambient Express Request augmentation
      ├─ types/auth-user.ts    AuthUser interface shared by middleware/routes
      └─ utils/logger.ts       minimal structured logger
```

### Why a script-only root package.json

npm workspaces resolve hoisted dependencies into a single top-level `node_modules`. That
**silently breaks** Vite (which expects its own `node_modules` next to its config) and Render
deploys (which `cd server && npm install && npm start` from a subdirectory and would not see
hoisted packages). Instead, the root `package.json` contains only **dev orchestration scripts**
(dev:server, dev:client, format, install:all) and `concurrently`+`prettier` as devDeps. Each
workspace owns its own `package.json` and `node_modules`. Trade-off: two `npm install`s instead
of one. Payoff: zero surprising hoisting behaviour across the two completely different toolchains
(Vite for client, tsx for server) and Deploy-on-Render works with no special config.

### Server language, runtime, and module system

- **ESM (`"type": "module"`)** instead of CommonJS: native top-level `await`, named imports
  matching the docs of every dependency, and `.js` extensions in relative imports (Node's ESM
  spec requires explicit extensions even when the source is `.ts`, and `tsx` honours that).
- **tsx** for dev (a Vite-native esbuild runner with watch mode), **`tsc`** for `build`,
  **`node dist/index.js`** for `start`. tsx is preferred over `ts-node` because it has zero
  TSConfig-negotiation overhead and prebuilt binaries — no node-gyp dance on Windows.
- **Node 24** LTS is targeted explicitly because the security-first spec calls for current
  platform crypto (`crypto.randomUUID()` in the request-id middleware) and modern fetch.

### TypeScript strictness

Server `tsconfig` enables the full strict family: `strict`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, and
`exactOptionalPropertyTypes`. The last one matters specifically for this codebase:
later steps emit `winner: null` into Postgres rows and return `message?` from error handlers.
With `exactOptionalPropertyTypes` the compiler rejects passing `{ message: undefined }` where
`message?: string` is declared, which prevents a subtle bug where `JSON.stringify` would still
emit `"message": undefined` and confuse the client interceptor. The cost is a few extra
type-checker warnings; the benefit is the security boundary is enforced by the type system, not
by convention.

### Environment validation with zod

A single schema in `server/src/config/env.ts` is the **only** source of truth for runtime
configuration. Every variable is parsed (not just type-checked) — `PORT` becomes a number,
`DATABASE_URL` is validated as a URL, `JWT_SECRET` must be ≥32 bytes. On startup, if the
schema doesn't match, the process throws with a readable per-field error list and never binds
the port — a misconfigured deploy fails loudly at boot instead of silently leaking later.

A tiny zero-dependency `.env` loader reads `./.env` and `./.env.local` in non-production
environments, layering them under the real `process.env` only when the key is _not already set_
(so deployment platform env vars always win over the file — important for Render). In
production the loader is skipped entirely; Render injects env vars and we never trust a
checked-in file with secrets.

### Structured logging

`utils/logger.ts` is a deliberately minimal logger — ~30 lines — that emits newline-delimited
JSON with level filtering by priority. The justification for not reaching for `pino` here is
specific to this step:

- The deploy target is Render, which ingests stdout and pretty-prints JSON log lines per
  request — so JSON output is required, but pino's extreme performance (async child loggers,
  worker-thread serialization) is wasted at the request volumes a hobby chess server sees.
- A 30-line logger is fully auditable in an interview; pulling in a logging framework in step 1
  adds an opinionated shape we may want to change once we know our log fields (request-id, game
  id, socket id) in step 6.
- If we outgrow it, the surface is tiny (`logger.info(msg, fields)`) so the swap to pino later
  is a single-file edit.

Errors and fatals go to `stderr`; everything else to `stdout`. Both streams are picked up by
Render's log drain.

### Express 5 security middleware ordering

The middleware chain in `index.ts` is intentionally ordered so the cheapest, broadest
protections run first:

1. **`helmet()`** — sets 16 response headers (CSP, HSTS, X-Frame-Options, Referrer-Policy,
   etc.). First so every response — including errors — protects the browser.
2. **`cors({ origin: CLIENT_ORIGIN, credentials: true })`** — single allowlisted origin (the
   Netlify URL in prod, `http://localhost:5173` in dev). `credentials: true` lets the browser
   send the `Authorization` header alongside the cookie-less JWT pattern we'll use.
3. **`express.json({ limit: '64kb' })`** — request body cap. The largest valid payload in this
   app will be a move object (`{from,to,promotion}` ~50 bytes) plus auth forms (~200 bytes);
   64KB is generous while rejecting the kind of large body that a malicious client could use to
   pin memory.
4. **Request-id middleware** — every request gets `req.id = crypto.randomUUID()`. This is the
   shared correlation id that the error handler, logger, and (in step 6) socket layer will all
   propagate.
5. **Routes** mount under `/api`.
6. **404 handler** — explicit `{error: "not_found"}` so the client can rely on a stable error
   shape (used by the axios interceptor in step 4).
7. **Error handler** — four-arg signature so Express treats it as the errorware, not a normal
   middleware. In production, `err.message` and `err.stack` are stripped from the response; the
   full detail goes only to the server logs.

### Typed request augmentation for `req.id` and `req.user`

Express's `@types/express` re-exports types from `express-serve-static-core`. To add fields to
`Request` (in step 3 we'll set `req.user` after JWT verification), we augment the
`express-serve-static-core` module. The two-file pattern (`auth-user.ts` for the shared
interface + `express.d.ts` for the ambient augmentation) was chosen after discovering that a
single `.d.ts` file mixing an exported interface with `declare module` confuses the
module-augmentation resolver under `moduleResolution: "Bundler"`. Splitting cleanly gives
type-safe `req.user`/`req.id` access everywhere they're used, with zero `any` casts.

### HTTP error contract

All error responses share one shape: `{ error: string, message?: string }`. `error` is a
**short stable code** (`not_found`, `internal_error`, `unauthorized`, `validation_error`),
never a free-form sentence — the client uses it as a switch case, not a message display.
`message` is a human sentence and is omitted in production to avoid leaking internal detail.
This single contract means the client's axios interceptor (step 4) needs just one parser and
the toast system in step 8 needs just one template.

### Frontend toolchain — Vite, React 19, Tailwind v4

- **Vite 6** over Create React App: CRA was officially sunset by the React team; Vite is the
  maintained path and the only one offering React 19 + the `@vitejs/plugin-react` SWC pipeline.
  Vite's HMR makes the dev loop near-instant.
- **React 19** to match the peer requirements of `react-chessboard@5` (its package matrix
  declares `react ^19.0.0`). Using React 18 risks peer warnings and untested drag-and-drop
  edge cases.
- **Tailwind v4** (the `@tailwindcss/vite` plugin) over v3: v4 is a CSS-first engine that reads
  the `@theme` block in `theme.css` and emits only the utilities actually used. No
  `tailwind.config.js` to maintain. The Vite plugin pipelines through the same esbuild
  transform as the rest of the build, avoiding a separate PostCSS pass.
- **`react-router-dom@6`** proxy-routes via `createBrowserRouter` (chosen over `Router` so SSR
  / pre-rendering is a future option without refactor). `<StrictMode>` is on in dev for
  double-render detection of effect/cleanup asymmetries.

### Dark-mode-first theme strategy

The theme is **dark-only by design** for this step:

- `index.html` carries `class="dark"` on `<html>` so the page is dark before React hydrates —
  no flash-of-light-content.
- `theme.css` defines design tokens in Tailwind v4's `@theme` block: a slate ramp `--color-slate-950..200`,
  a neon-cyan accent for primary actions (`--color-neon-400..600`), and three state accents
  (violet for highlight, emerald for success, rose for error). Concentrating color names at the
  theme layer means a designer can rebrand the app by editing one file.
- The `@layer base` block sets `color-scheme: dark` (so form controls and scrollbars render
  dark), the body background/foreground, the focus ring (2px neon, offset 2px — meets WCAG
  2.2 SC 1.4.11), and the text selection color.
- Tailwind's arbitrary-value syntax (e.g. `bg-[radial-gradient(60rem_60rem_at_50%_-20%,...)]`
  on the Landing hero) lets us compose bespoke visuals without leaving the JSX or inventing a
  custom class name. The gradient is a soft cyan radial that telegraphs "this is a chess arena"
  without competing with the board's contrast.

### Dev proxy so a single origin serves the browser

`vite.config.ts` proxies `/api` and `/socket.io` (the latter with `ws: true`) to
`http://localhost:4000`. This is the **simplest possible** security story in dev: the browser
only ever talks to one origin (`localhost:5173`), so no CORS preflight, no cookie `SameSite`
hand-wringing, and most importantly, no `VITE_API_URL` env var to forget. The same-origin proxy
dies in production, where Netlify serves the built bundle and the axios client sends to the
Render URL — that swap happens in step 11 via a `VITE_API_URL` injected at build time.

### Verified third-party API surface

Before writing any feature code, this step's dependencies were verified against the actual
installed packages and authoritative docs (changelog noted in this commit's RESEARCH block
below). Specifics that materially affected scaffolding decisions:

- **`chess.js@1.4.0`** — exports `Chess` from the package root; `move()` **throws** on illegal
  moves (it does _not_ return `null` like v0.x). Server wrappers in step 6 will always wrap
  `chess.move(...)` in try/catch.
- **`react-chessboard@5.12.0`** — single `options` prop object. Confirmed against the
  installed `dist/*.d.ts`: `position?: string`, `onPieceDrop({piece, sourceSquare, targetSquare}) => boolean`,
  `boardOrientation?: 'white' | 'black'`, `allowDrawingArrows?`, `arrows?`,
  `squareStyles?`, `animationDurationInMs?`, `id?`. The v4 flat-prop API used by ~95% of
  tutorials is gone — our JSX in step 9 will use the verified v5 signature.
- **`express@5`** — current major; `app.listen` semantics changed, so we use the
  `createServer(app)` + `httpServer.listen(port)` pattern that Socket.IO v4 documents.
- **`jsonwebtoken@9`** — `sign`/`verify` synchronous API stable; we'll use it in step 3.
- **`@node-rs/argon2`** — Argon2id via napi-rs (prebuilt binaries, no toolchain). OWASP
  favours Argon2id over bcrypt for new systems (bcrypt retained only for legacy migrations).

---

_This section closes Step 1. Subsequent steps append below with the same "what / why /
justification" structure._
