import { type GameResult, type RecentGame } from '../api/http';

interface MatchHistoryTableProps {
  games: RecentGame[];
}

// Pill colour per result, using the accent tokens so the table reuses the
// dashboard's vocabulary rather than inventing its own shades.
const RESULT_STYLES: Record<GameResult, string> = {
  win: 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald',
  loss: 'border-accent-rose/40 bg-accent-rose/10 text-accent-rose',
  draw: 'border-slate-600/40 bg-slate-600/10 text-slate-300',
};

const RESULT_LABEL: Record<GameResult, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
};

// Termination is snake_case from the DB; surface a friendlier label.
const TERMINATION_LABEL: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw_threefold: 'Draw — threefold',
  draw_fiftymove: 'Draw — 50-move',
  draw_insufficient: 'Draw — insufficient',
  draw_agreed: 'Draw — agreed',
  resignation: 'Resignation',
  timeout: 'Timeout',
  aborted: 'Aborted',
};

const TIME_CONTROL_LABEL: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  custom: 'Custom',
};

const endDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The recent-games table for the dashboard. The server already paginates a
 * page of 20 and hydrates the opponent's username + the player's colour +
 * Elo delta, so this component is purely presentational -- no client-side
 * joins, no N+1 fan-out.
 */
export function MatchHistoryTable({ games }: MatchHistoryTableProps): React.JSX.Element {
  if (games.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
        <p className="text-sm text-slate-500">
          No games yet. Matchmaking opens in the next step.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto scrollbar-slim">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs font-medium tracking-wide text-slate-400 uppercase">
            <th className="px-3 py-2.5">Opponent</th>
            <th className="px-3 py-2.5">Result</th>
            <th className="px-3 py-2.5">Elo</th>
            <th className="px-3 py-2.5">Time</th>
            <th className="px-3 py-2.5">Played</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => {
            const endedAt = new Date(game.endedAt);
            const delta = game.eloDelta;
            return (
              <tr
                key={game.id}
                className="border-b border-slate-800/60 transition hover:bg-slate-900/40"
              >
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2 text-slate-200">
                    <span
                      aria-hidden
                      className={
                        game.myColor === 'w'
                          ? 'size-2.5 rounded-full border border-slate-600 bg-slate-100'
                          : 'size-2.5 rounded-full bg-slate-950 ring-1 ring-slate-600'
                      }
                      title={`You played ${game.myColor === 'w' ? 'White' : 'Black'}`}
                    />
                    {game.opponent.username}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      RESULT_STYLES[game.myResult]
                    }`}
                    title={TERMINATION_LABEL[game.termination] ?? game.termination}
                  >
                    {RESULT_LABEL[game.myResult]}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono">
                  {delta === null ? (
                    <span className="text-slate-500">—</span>
                  ) : delta === 0 ? (
                    <span className="text-slate-400">±0</span>
                  ) : delta > 0 ? (
                    <span className="text-accent-emerald">+{delta}</span>
                  ) : (
                    <span className="text-accent-rose">{delta}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-300">
                  {TIME_CONTROL_LABEL[game.timeControl] ?? game.timeControl}
                </td>
                <td className="px-3 py-3 text-slate-400">
                  {endDateFormatter.format(endedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
