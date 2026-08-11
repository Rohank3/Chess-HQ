import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

export function Register(): React.JSX.Element {
  const { register, loginAsGuest } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(username, email.trim(), password);
      // No session is issued at registration — the account activates only
      // once the emailed verification link is clicked.
      navigate(`/verify-email-sent?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      const { message } = err as SubmitError;
      push('error', message);
    } finally {
      setBusy(false);
    }
  }

  async function continueAsGuest() {
    setGuestBusy(true);
    try {
      await loginAsGuest();
      push('success', 'Playing as a guest.');
      navigate('/dashboard');
    } catch (err) {
      const { message } = err as SubmitError;
      push('error', message);
    } finally {
      setGuestBusy(false);
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
        <h1 className="text-2xl font-semibold text-slate-100">Create your account</h1>
        <p className="mt-2 text-sm text-slate-400">
          Email is required so you can recover your password if you ever forget it.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Username
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z0-9_-]+"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
            />
          </label>
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
          <label className="block">
            <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Password
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
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-800" />
          or
          <span className="h-px flex-1 bg-slate-800" />
        </div>
        <button
          type="button"
          onClick={continueAsGuest}
          disabled={guestBusy}
          className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {guestBusy ? 'Starting…' : 'Continue as guest'}
        </button>
        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="text-neon-400 hover:text-neon-500">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
