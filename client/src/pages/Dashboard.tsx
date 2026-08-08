import { useAuth } from '../context/AuthContext';

export function Dashboard(): React.JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-slate-400">Loading…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-slate-400">Sign in to view your dashboard.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-slate-100">{user.username}</h1>
      <p className="mt-2 text-sm text-slate-400">
        Elo <span className="font-mono text-neon-400">{user.elo}</span> · Dashboard coming
        in Step 8.
      </p>
      <div className="mt-8 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-12 text-center">
        <p className="text-sm text-slate-500">
          The full profile + match-history view lands in Step 8.
        </p>
      </div>
    </main>
  );
}
