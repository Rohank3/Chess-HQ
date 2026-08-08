import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface SubmitError {
  code: string;
  message: string;
}

export function Register(): React.JSX.Element {
  const { register } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(username, email.trim() === '' ? null : email.trim(), password);
      push('success', 'Account created. Welcome to Chess-HQ.');
      navigate('/');
    } catch (err) {
      const { message } = err as SubmitError;
      push('error', message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
        <h1 className="text-2xl font-semibold text-slate-100">Create your account</h1>
        <p className="mt-2 text-sm text-slate-400">
          No email required — just a username.
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
              Email (optional)
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
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
