import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { http } from '../api/http';

/**
 * /verify-email-sent — shown right after registration. The account is
 * PENDING until the emailed link is clicked, so this page (no login
 * required) confirms the email went out and offers a resend keyed by
 * address. The server answers identically for any email (anti-enumeration).
 */
export function VerifyEmailSent(): React.JSX.Element {
  const [params] = useSearchParams();
  const initial = params.get('email') ?? '';
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function resend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post('/api/auth/resend-verification', { email: email.trim() });
      setSent(true);
    } catch {
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full bg-neon-400 shadow-[0_0_10px_3px_var(--color-neon-400)]"
          />
          <span className="text-sm font-semibold tracking-[0.25em] text-slate-200 uppercase">
            Chess-HQ
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-100">Check your inbox</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your account is created but not yet active — we emailed a verification link to{' '}
          <span className="font-medium text-slate-200">{initial || 'your address'}</span>. Click it
          to activate your account, then sign in.
        </p>

        {!sent ? (
          <form onSubmit={resend} className="mt-6 space-y-3 text-left">
            <label className="block">
              <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                Didn't get it? Resend to
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={254}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Resend verification email'}
            </button>
            <p className="text-center text-xs text-slate-500">
              Tip: check spam — verification emails occasionally land there.
            </p>
          </form>
        ) : (
          <p className="mt-6 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 p-4 text-sm text-accent-emerald">
            A fresh verification link is on its way. Click it to activate your account.
          </p>
        )}

        <p className="mt-6 text-sm text-slate-400">
          Already verified?{' '}
          <Link to="/login" className="text-neon-400 hover:text-neon-500">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
