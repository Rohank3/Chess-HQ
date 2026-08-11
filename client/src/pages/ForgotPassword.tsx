import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../api/http';

/**
 * /forgot-password — enter your email and receive a one-time reset link.
 * The server always answers success (anti-enumeration); the user only learns
 * whether the account exists from their inbox.
 */
export function ForgotPassword(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await http.post('/api/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch {
      // Even on a transport failure the page says the same thing — no signal
      // about whether the email exists.
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="size-2 rounded-full bg-neon-400 shadow-[0_0_10px_3px_var(--color-neon-400)]"
          />
          <span className="text-sm font-semibold tracking-[0.25em] text-slate-200 uppercase">
            Chess-HQ
          </span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-100">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter the email on your account and we'll send a one-time reset link.
        </p>
        {!sent ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                Email
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
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        ) : (
          <p className="mt-6 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 p-4 text-sm text-accent-emerald">
            If an account exists for that email, a reset link is on its way. It expires in 1 hour.
          </p>
        )}
        <p className="mt-6 text-center text-sm text-slate-400">
          Remembered it?{' '}
          <Link to="/login" className="text-neon-400 hover:text-neon-500">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
