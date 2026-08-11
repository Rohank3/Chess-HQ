# Email setup guide (verification + password reset)

The app now requires an email at sign-up and uses it for two things:

1. **Email verification (activation gate)** — a link is emailed at
   registration and the account is PENDING until you click it: you can't
   sign in before that (login says "verify your email to activate your
   account"), and the "check your inbox" page can resend the link.
2. **Password reset** — only verified accounts receive reset links, via
   `/forgot-password` → emailed one-time link → `/reset-password`.

Email is **off by default**: with `EMAIL_PROVIDER=none` (the dev default),
the server just logs every message — including the full link — to its
console, so nothing is actually sent until you configure a provider.

Two providers are built in:

- **[Resend](https://resend.com)** (recommended) — free tier is 3,000
  emails/month and 100/day. ⚠️ The shared `onboarding@resend.dev` sender
  **can only deliver to the email address you registered Resend with**;
  sending to real users requires verifying your own domain (section 3).
- **SMTP** — no domain needed; use your personal Gmail (or any SMTP
  server) as the sending account. Section 5.

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
  domain in Resend (section 3). The display name in front (`Chess-HQ`) is
  free to change.
- **This only ever sends mail to your own inbox.** `onboarding@resend.dev`
  is Resend's testing sender — it delivers to the address on your Resend
  account and silently rejects every other recipient. The app reports
  "success" either way (anti-enumeration), so the failure only shows in the
  server logs as `mail_send_failed … Resend API error 403`.
- After changing env vars on Render, **Deploy** so the new values take effect.

## 3. Verify your own domain (required before real users get mail)

Because of the restriction above, you must add a domain before the app can
email anyone other than you:

1. Resend → **Domains** → **Add Domain**, enter the domain you own (e.g.
   `chesshq.com`).
2. Add the three DNS records Resend shows you (SPF, DKIM, and a MX/return-path
   record) at your DNS provider. SPF + DKIM are what make Gmail trust you.
3. Wait for the domain status to become **Verified** (minutes to a few hours).
4. Set `EMAIL_FROM=Chess-HQ <no-reply@yourdomain.com>` and redeploy.

No domain? Skip straight to **section 5** — SMTP needs none.

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

## 5. Alternative: SMTP (no domain needed)

Use any SMTP server as the sender — your personal **Gmail** is the
zero-cost option (~500 emails/day, plenty for verification + resets).

### Gmail setup

1. **Turn on 2-Step Verification** on the Google account
   (https://myaccount.google.com/security).
2. **Security → App passwords** → create one for "Mail" → copy the 16-char
   password (it looks like `abcd efgh ijkl mnop` — remove the spaces).
3. Add these env vars to **Render** (and `server/.env` for local testing):

   ```env
   EMAIL_PROVIDER=smtp
   EMAIL_FROM=Chess-HQ <yourname@gmail.com>
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=yourname@gmail.com
   SMTP_PASS=the16charapppassword
   ```

4. **Deploy** the Render service and register a test account — mail should
   arrive at any address within a minute.

### Other SMTP servers

`SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` are generic: any provider's SMTP
works (Zoho, Outlook, your own mail server). For STARTTLS use port 587 with
`SMTP_SECURE=false`.

### SMTP troubleshooting: `ENETUNREACH` / `Connection timeout`

Render's free instances have **no outbound IPv6**, and `smtp.gmail.com`
publishes IPv6 (AAAA) records. If the server's DNS lookup picks the IPv6
address first, every send dies before reaching Gmail, e.g.:

```
{"msg":"mail_send_failed","context":"resend","message":"connect ENETUNREACH 2607:f8b0:...:465 - Local (:::0)"}
```

The server forces IPv4-first resolution for all outbound connections
(`setDefaultResultOrder('ipv4first')` at the top of `server/src/index.ts`),
which fixes exactly this. If you still see the error after pulling that
commit, **redeploy** — the fix only takes effect once a build containing it
is live, and a Render redeploy is the only way to get the new code running
(changing env vars in the dashboard does not rebuild). Confirm which commit
the latest deploy actually built from on the service's **Deploys** tab.

After redeploying, the **boot logs** verify the mail path by themselves:

- `mail_config` shows the resolved provider plus `"node":"v…"` and
  `smtpHostResolved` — the address list; IPv4-first means the fix is live.
- `mail_smtp_check` connects + authenticates against the mail host without
  sending: `"ok":true` means the server can deliver, `"ok":false` logs the
  exact error (no need to register an account to find out).

If `mail_smtp_check` reports `ok:false` with a timeout / ENETUNREACH even on
the fixed build, Gmail's 465 port may be unreachable from Render's network:
try `SMTP_PORT=587` with `SMTP_SECURE=false` (STARTTLS), or switch to the
Resend provider (section 2), which goes out over plain HTTPS.

### SMTP trade-offs vs a verified Resend domain

- **Free and instant** — no domain, no DNS records.
- Every message shows **your personal address** as the sender, and replies
  land in your personal inbox. Deliverability is decent (fine Gmail→Gmail)
  but a verified domain is more trustworthy to spam filters.
- The App Password is a real credential — keep it in the Render env var,
  never in code or public repos.

## If you'd rather use something else

The mailer has a single seam (`server/src/services/mailer.ts`). `resend`
and `smtp` are built in; to add another provider, add a `sendViaXxx()`
adapter and a new `EMAIL_PROVIDER` enum value in
`server/src/config/env.ts` — the routes, tokens, and UI don't care which
provider is behind it.
