# Email Verification + Password Reset — Scope & Requirements

Status: **Draft for review — no code written yet**
Owner: Chess-HQ
Date: 2026-08-11

---

## 1. Context (current state)

- `users.email` already exists: **optional**, `UNIQUE`, format-checked, captured at registration (`server/src/db/migrations/001_init.sql`, `registerSchema` in `security/validation.ts`).
- Nothing else uses it. There is **no mail-sending infrastructure** (no nodemailer / Resend / SendGrid / SES dependency in `server/package.json`), no email-verification state, no password-reset flow, and no forgot-password UI.
- Login is **username-only** (`POST /api/auth/login` matches `LOWER(username)`; the form field is labelled "identifier" but email is not accepted).
- Auth is JWT-based with argon2 password hashing; a per-route rate limiter already exists (`security/rate-limit.ts`, e.g. register 5/min, login 10/min).
- Server env is validated centrally in `config/env.ts` (zod) — new mail settings belong there. `CLIENT_ORIGIN` already exists and is the natural base for building emailed links.
- Backend deploys on Render; client is a Vite SPA (deployed via Netlify per `CLIENT_ORIGIN` comments).
- Guests have no password/email and are out of scope for every flow here.

**Why this matters:** today a user who forgets their password is locked out permanently — there is no recovery path at all. Password reset is impossible to do safely without a verified email (otherwise anyone could reset someone else's account), so email verification is a prerequisite, not a nice-to-have.

---

## 2. Goals

1. Let users **verify ownership of their email address** (link sent after registration).
2. Let verified users **recover their account** via a one-time password-reset link sent to that email.
3. Do it with **industry-standard token security** (hashed-at-rest, expiring, single-use) and the project's existing rate-limit/validation conventions.
4. Keep the flow **optional and low-friction** — no user is locked out of playing because they skipped verification.

## 3. Non-goals (explicitly out of scope for v1)


- ❌ Changing / re-adding an email address in account settings (needs its own verify flow — defer).
- ❌ Gating features behind verification (e.g. blocking ranked play for unverified users — defer).
- ❌ Email sign-in / magic links, 2FA, or "log in with email" (login stays username-only for now).
- ❌ Username recovery ("what's my username?") — out of scope.
- ❌ Marketing/newsletter emails of any kind.
- ✅ Email **is** required at registration (decided 2026-08-11, along with the activation gate).
- ❌ Self-hosted SMTP server operation — we use a managed provider or SMTP relay only.

---

## 4. Functional requirements

### FR-1 Register with email (activation gate)
- Email is **required** at registration (form, schema, DB constraint `users_email_required` — guests and legacy email-less rows exempt).
- Registration creates a **pending** account and issues **no session**: a verification link is emailed, and the user lands on `/verify-email-sent` ("Check your inbox", with a resend keyed by email address).
- **The account cannot be used until the emailed link is clicked** — login rejects pending accounts with `403 email_not_verified` and points at the resend flow. Verification is a gate on registration, not an afterthought.

### FR-2 Verify email
- `GET/POST /api/auth/verify-email?token=<token>` consumes the token.
  - Valid → `email_verified_at = now()`, token invalidated, user redirected to the app with a success message ("Email verified").
  - Invalid/expired/already-used → friendly failure page ("Link invalid or expired") with a **Resend** action.
- Expiry: **24 hours** from issue.

### FR-3 Resend verification
- `POST /api/auth/resend-verification { email }` — unauthenticated (a pending account can't sign in, so the "didn't get the email?" page must work without a session). Responds identically whether or not a pending account exists (anti-enumeration); rate-limited to avoid inbox spam.

### FR-4 Forgot password (unauthenticated)
- Only **verified** accounts can receive a reset link; unverified ones get a "verify first" email.
- `POST /api/auth/forgot-password { email }`:
  - Always responds success-ish (200/202) **regardless of whether the email exists** — prevents account enumeration.
  - If the email belongs to a registered, **verified**, non-guest user: mint a reset token (expiry **1 hour**), email the reset link.
  - If unverified: do **not** send a reset link (that's the whole point of verification). Optionally send a "verify your email first" email — decision below (Open Decisions D4).
- Rate-limited aggressively (e.g. 5/min/IP and 5/min/email).

### FR-5 Reset password
- `POST /api/auth/reset-password { token, newPassword }`:
  - Valid token → set new password (argon2), **invalidate all outstanding tokens for that user** (reset + verification), respond 200.
  - Invalid/expired/used → 400 with a clear message; no partial state.
  - Success screen: "Password updated — sign in."
- Password rules reuse the existing `passwordSchema` (8–128 chars).

### FR-6 Auth responses
- `POST /api/auth/login`, `/me`, `/refresh` may optionally surface `emailVerified: boolean` in the public user object so the client can render the verify banner without an extra call. No behavior change otherwise.

---

## 5. Data model (migration `004`)

Add to `users` (keep it simple — one active token per kind per user):

| column | type | notes |
|---|---|---|
| `email_verified_at` | `timestamptz NULL` | set once on successful verify |
| `verify_token_hash` | `text NULL` | sha256 of raw token; null when none outstanding |
| `verify_token_expires_at` | `timestamptz NULL` | 24h |
| `reset_token_hash` | `text NULL` | sha256 of raw token |
| `reset_token_expires_at` | `timestamptz NULL` | 1h |

- Tokens are `crypto.randomBytes(32)` hex; **only the SHA-256 hash is stored** (DB leak ≠ token leak). This matches the argon2-at-rest posture of passwords.
- Single-active-token-per-kind: issuing a new token overwrites the old (resend/forgot rotates).
- Alternative considered: a separate `auth_tokens` table. Cleaner for many-token histories, but columns are sufficient for one outstanding token per kind and avoid a new table + cleanup sweep. **Recommend columns.** Revisit if we add email-change/2FA later.

---

## 6. Security requirements (non-negotiable)

- **S1** Raw tokens never logged, never returned in responses, only hashed at rest.
- **S2** All tokens expiring; verify ≤24h, reset ≤1h.
- **S3** Single-use: consumed on success (deleted/rotated). A reset or verify **invalidates every other outstanding token for that user**.
- **S4** No user enumeration: forgot-password response is identical whether the email exists or not; no timing side channel (hash lookup is fast either way — same code path).
- **S5** Rate limits on every new endpoint (new `rateLimit` scopes: `verify`, `resend`, `forgot`, `reset`), consistent with existing auth endpoints.
- **S6** Guests excluded everywhere; reset only for users with a `password_hash` (covers legacy rows).
- **S7** Emailed links point at the client app (`CLIENT_ORIGIN`), not the API, so tokens ride only in the URL to the SPA; the SPA posts the token to the API. Link includes no other user data.
- **S8** Reset/re-verify must not log the user in implicitly (no token→session conversion).
- **S9** Failure messages distinguish "expired" vs "already used" only on the *token* screen, never on the forgot-password input (S4).

---

## 7. Email infrastructure

- New `server/src/services/mailer.ts` — a single `sendMail({ to, subject, text, html })` with two adapters behind one interface:
  - **dev**: log the rendered email to the console (and support `MAIL_TRAP_URL`/Mailpit later) — zero setup, keeps `npm test` hermetic.
  - **prod**: a managed provider.
- New env vars (all optional **unless** a provider is configured, so dev works out of the box):
  - `EMAIL_PROVIDER` (`none | resend | smtp` — default `none` = dev console mode)
  - `EMAIL_FROM` (e.g. `Chess-HQ <no-reply@domain>`)
  - `RESEND_API_KEY` **or** `SMTP_HOST/PORT/USER/PASS` (per provider choice)
- **Provider recommendation: Resend** — simple HTTP API, generous free tier (3k emails/mo), no long-term commitment, works from Render. SES is the alternative if the user already has AWS; SMTP (nodemailer) if they have a mail server. **Decision needed (D1).**
- Link base: reuse `CLIENT_ORIGIN` (already validated/normalized) → `{CLIENT_ORIGIN}/verify-email?token=...`, `{CLIENT_ORIGIN}/reset-password?token=...`.

---

## 8. Client UI (Vite SPA)

| page/route | purpose |
|---|---|
| `/verify-email?token=…` | consumes token via API; success / expired states; Resend button on failure |
| `/forgot-password` | email input → "If an account exists, we sent a link." (anti-enumeration copy) |
| `/reset-password?token=…` | new password + confirm → success → link to login |
| Login page | add "Forgot password?" link |
| Register success | non-blocking "verify your email" hint |
| Dashboard | dismissible banner when `emailVerified === false && email set`: verify + resend |

No new routing library — the app's existing react-router setup.

---

## 9. Testing

- **Unit**: token mint/hash/expiry; rotate-on-issue; single-use enforcement; TTL boundary.
- **API integration** (matches existing test style, `vitest`/supertest against the test DB): full happy path register→verify→forgot→reset→login; expired token; used token; wrong-password rules; guest excluded; anti-enumeration (same response for unknown vs known email); rate-limit 429s.
- **Mailer**: stub adapter asserts the email *would* be sent with correct recipient/link in CI (no real provider needed).
- **Manual**: dev mode sends nothing, logs links to console for click-through.

---

## 10. Rollout / sequencing

1. **P0 — Decisions** (needs user input, §11): provider + API key, required vs optional email, from-address/domain.
2. **P1 — Infra**: migration 004; `services/mailer.ts` (+ env vars); token service (`security/tokens.ts`).
3. **P2 — API**: verify / resend / forgot / reset endpoints + rate limits + public-user `emailVerified`; full test suite.
4. **P3 — UI**: the five client surfaces in §8.
5. **P4 — Hardening**: deliverability check (SPF/DKIM for the from-domain if custom), manual end-to-end on Render, banner copy pass.

---

## 11. Open decisions (need your input)

- **D1 — Email provider.** Resend (recommended, free tier) / AWS SES / SendGrid / own SMTP. Whoever picks: an account + API key must exist; I'll wire whichever.
- **D2 — Required vs optional email.** Recommend staying **optional + recommended**: current users keep working, and registration friction stays low. Consequence: accounts without an email can't reset — acceptable?
- **D3 — From-address/domain.** For reliable delivery to Gmail/Outlook, a custom domain with SPF/DKIM is ideal. If none exists, we can send from an `onrender.com` subdomain address (works, occasionally filtered). Do you have a domain to dedicate?
- **D4 — Unverified forgot-password.** Send "your email isn't verified yet" mail, or stay silent (strictest anti-enumeration)? Recommend: send it — the address is already confirmed by the requester, and it helps users finish verification.
- **D5 — Email-change flow.** Confirm it's deferred (it is, per §3).
