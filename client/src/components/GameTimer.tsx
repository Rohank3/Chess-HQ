interface GameTimerProps {
  ms: number;
  /** is this the side to move right now, and is the game live? */
  active: boolean;
  flagFallen: boolean;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 1) {
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  // Under 1 minute, show tenths so the flag-fall tension is legible.
  const tenths = Math.floor(Math.max(0, ms) / 100) % 10;
  return `0:${String(s).padStart(2, '0')}.${tenths}`;
}

/**
 * One side's chess clock. Pure presentational -- the `ms` is the
 * interpolated bank value from `useTimer`. Reads no context so it can be
 * used for either colour.
 */
export function GameTimer({ ms, active, flagFallen }: GameTimerProps): React.JSX.Element {
  const ring = flagFallen
    ? 'border-accent-rose/40 bg-accent-rose/10 text-accent-rose shadow-[0_0_10px_-2px_var(--color-accent-rose)]'
    : active
      ? 'border-neon-500/40 bg-neon-500/10 text-neon-400 shadow-[0_0_8px_-2px_var(--color-neon-500)]'
      : 'border-slate-700 bg-slate-900/60 text-slate-200';

  return (
    <div
      className={`inline-flex min-w-[7.5rem] items-center justify-center rounded-lg border px-3 py-1.5 font-mono text-lg tabular-nums ${ring}`}
      aria-live="off"
    >
      {formatClock(ms)}
    </div>
  );
}
