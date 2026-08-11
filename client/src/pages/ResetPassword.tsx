import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { http } from '../api/http';
import { Spinner } from '../components/Spinner';

type Status = 'idle' | 'submitting' | 'done' | 'failed';

/**
 * /reset-password?token=… — the destination of the emailed reset link.
 * Sets a new password with the one-time token, then points at sign-in.
 */
export function ResetPassword(): React.JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setError(null);
    setStatus('submitting');
    try {
      await http.post('/api/auth/reset-password', { token, password });
      setStatus('done');
    } catch (err) {
      const message = (err as { message?: string }).message;
      setError(message ?? 'This reset link is invalid or has expired.');
      setStatus('failed');
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

        {status === 'done' ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Password updated</h1>
            <p className="mt-2 text-sm text-slate-400">
              Your new password is set. Sign in with it below.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-block w-full rounded-lg bg-neon-500 px-4 py-2.5 text-center text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
            >
              Sign in
            </Link>
          </>
        ) : status === 'submitting' ? (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Setting your password…</h1>
            <div className="mt-6 flex justify-center">
              <Spinner label="Setting your password…" />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-slate-100">Choose a new password</h1>
            <p className="mt-2 text-sm text-slate-400">
              Enter a new password for your account. The link works once and expires in 1 hour.
            </p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <label className="block">
                <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                  New password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
                  Confirm password
                </span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
                />
              </label>
              {error && <p className="text-sm text-accent-rose">{error}</p>}
              <button
                type="submit"
                className="w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400"
              >
                Set new password
              </button>
            </form>
            {status === 'failed' && (
              <p className="mt-4 text-center text-sm text-slate-400">
                <Link to="/forgot-password" className="text-neon-400 hover:text-neon-500">
                  Request a new link
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
