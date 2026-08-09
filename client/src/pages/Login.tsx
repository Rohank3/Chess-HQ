import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

export function Login(): React.JSX.Element {
  const { login, loginAsGuest } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(identifier, password);
      push('success', 'Welcome back.');
      navigate('/');
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
        <h1 className="text-2xl font-semibold text-slate-100">Sign in</h1>
        <p className="mt-2 text-sm text-slate-400">Pick up where you left off.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Username
            </span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
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
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-neon-500 focus:ring-2 focus:ring-neon-500/30"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-neon-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
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
          No account?{' '}
          <Link to="/register" className="text-neon-400 hover:text-neon-500">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
