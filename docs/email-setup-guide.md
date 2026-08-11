# Email setup guide (verification + password reset)

The app now requires an email at sign-up and uses it for two things:

1. **Email verification** — a link is emailed after registration; the
   dashboard shows a "Verify your email" banner until it's done.
2. **Password reset** — only verified addresses receive reset links, via
   `/forgot-password` → emailed one-time link → `/reset-password`.

Email is **off by default**: with `EMAIL_PROVIDER=none` (the dev default),
the server just logs every message — including the full link — to its
console, so nothing is actually sent until you configure a provider.

**Recommended provider: [Resend](https://resend.com)** — free tier is
3,000 emails/month and 100/day, which is far more than a hobby chess app
needs. Everything below uses Resend.

---

## 1. Create a Resend account and get an API key

1. Sign up at https://resend.com (free).
2. Open **API Keys** (https://resend.com/api-keys) → **Create API Key**.
   - Permission: **Sending access** is enough.
   - Copy the key (`re_...`). It is shown once — save it somewhere safe.

## 2. Add the environment variables

The server needs three settings. Add them to your **Render service's
environment** (Dashboard → your service → *Environment*), and to your local
`server/.env` if you test email locally:

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Chess-HQ <onboarding@resend.dev>
```

- `EMAIL_FROM` must be `onboarding@resend.dev` **until** you verify your own
  domain in Resend (step 3). The display name in front (`Chess-HQ`) is free
  to change.
- After changing env vars on Render, **Deploy** (or the service auto-restarts)
  so the new values take effect.

## 3. (Recommended) Verify your own domain for delivery reliability

Emails from `onboarding@resend.dev` deliver, but Gmail/Outlook may filter
them more aggressively than mail from your own domain.

1. Resend → **Domains** → **Add Domain**, enter the domain you own (e.g.
   `chesshq.com`).
2. Add the three DNS records Resend shows you (SPF, DKIM, and a MX/return-path
   record) at your DNS provider. SPF + DKIM are what make Gmail trust you.
3. Wait for the domain status to become **Verified** (minutes to a few hours).
4. Set `EMAIL_FROM=Chess-HQ <no-reply@yourdomain.com>` and redeploy.

## 4. Verify it works

1. Register a new account in the app (or use the dashboard **Resend
   verification email** button on an existing account).
2. Within a minute the email should arrive at the address you signed up
   with; click the link → the app says **"Email verified"**.
3. Check `/forgot-password` (login page → *Forgot password?*): enter the
   address and the reset link should arrive.

If no email arrives, check the server logs on Render for `mail_send_failed`
lines with the exact Resend error (common causes: wrong API key, unverified
From domain, or the 100/day free cap being hit).

## 4b. Local dev without sending

Leave `EMAIL_PROVIDER=none` (default) and the server logs every message,
e.g.:

```
{"msg":"mail_dev_send","to":"you@example.com","subject":"Confirm your Chess-HQ email","text":"... http://localhost:5173/verify-email?token=... "}
```

Open the link in the log to complete verification locally. No API key
needed, nothing leaves your machine.

---

## Free-tier limits to know

- **3,000 emails / month**, **100 / day** on Resend's free plan.
- Each sign-up sends **one** verification email; each reset request sends
  **one**. Real usage is a few dozen a month — you will not hit the cap.
- If you ever do: resend is rate-limited server-side (3/60s per user, 5/min
  per IP for forgot-password), so a stray script can't burn the quota.

## If you'd rather use something else

The mailer has a single seam (`server/src/services/mailer.ts`). To swap
providers, add a `sendViaXxx()` adapter next to `sendViaResend()` and a new
`EMAIL_PROVIDER` enum value in `server/src/config/env.ts` — the routes,
tokens, and UI don't care which provider is behind it.
