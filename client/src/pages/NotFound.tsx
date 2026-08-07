import { Link } from 'react-router-dom';

export function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="text-6xl font-bold text-neon-400">404</p>
      <p className="mt-4 text-slate-400">This square of the board is empty.</p>
      <Link
        to="/"
        className="mt-8 rounded-lg border border-slate-700 bg-slate-900/60 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
      >
        Back to lobby
      </Link>
    </main>
  );
}
