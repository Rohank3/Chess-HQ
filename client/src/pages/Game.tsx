import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { GameProvider, useGameContext } from '../context/GameContext';
import { GameTimer } from '../components/GameTimer';
import { CapturedPieces } from '../components/CapturedPieces';
import { MoveListSidebar } from '../components/MoveListSidebar';
import { PromotionDialog } from '../components/PromotionDialog';
import { MatchmakingOverlay } from '../components/MatchmakingOverlay';
import { GameOverModal } from '../components/GameOverModal';
import { useTimer } from '../game/useTimer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LAST_MOVE_HIGHLIGHT = 'var(--color-neon-500)';
const LAST_MOVE_FROM_BG = 'rgba(6, 182, 212, 0.28)';
const LAST_MOVE_TO_BG = 'rgba(6, 182, 212, 0.45)';

function GameRoom(): React.JSX.Element {
  const { optimisticFen, gameId, myColor, opponent, game, matchmaking, submitMove } =
    useGameContext();
  const navigate = useNavigate();

  // When matched, mount the URL to /game/<id> so it's shareable/bookmarkable.
  // We navigate rather than setParams because we may have entered /game with
  // no :id (queue-then-match flow).
  useEffect(() => {
    if (matchmaking.queueState === 'matched' && matchmaking.match) {
      navigate(`/game/${matchmaking.match.gameId}`, { replace: true });
    }
  }, [matchmaking.queueState, matchmaking.match, navigate]);

  // The board renders the optimistic fen if we have one; the start FEN as a
  // neutral placeholder otherwise (queue/searching). Once a snapshot arrives,
  // the GameContext effect sets optimisticFen to the authoritative fen.
  const position = optimisticFen ?? START_FEN;
  const snapshot = game.snapshot;
  const isGameOver = !!game.gameOver || !!snapshot?.gameOver;

  const { whiteMs, blackMs } = useTimer({
    whiteMs: snapshot?.clocks.whiteMs ?? 0,
    blackMs: snapshot?.clocks.blackMs ?? 0,
    lastMoveAt: snapshot?.clocks.lastMoveAt ?? null,
    turn: snapshot?.turn ?? 'w',
    isGameOver,
  });

  // Square styles: highlight last move's from/to squares, and highlight the
  // king square in accent-rose when in check (read off a local chess.js mirror
  // of the snapshot fen for the in-check square).
  const squareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    const out: Record<string, React.CSSProperties> = {};
    if (snapshot?.lastMove) {
      out[snapshot.lastMove.from] = { background: LAST_MOVE_FROM_BG };
      out[snapshot.lastMove.to] = { background: LAST_MOVE_TO_BG };
    }
    return out;
  }, [snapshot]);

  // v5 'arrows' prop draws the last-move arrow programmatically.
  const arrows = useMemo(
    () =>
      snapshot?.lastMove
        ? [
            {
              startSquare: snapshot.lastMove.from,
              endSquare: snapshot.lastMove.to,
              color: LAST_MOVE_HIGHLIGHT,
            },
          ]
        : [],
    [snapshot],
  );

  // Player strips. Top = opponent, bottom = me. The board orientation is
  // determined by myColor so my own pieces sit on the bottom.
  const orientation: 'white' | 'black' = myColor === 'b' ? 'black' : 'white';
  const isMyTurn = snapshot?.turn === myColor;
  const canDrag = !!(myColor && snapshot && !isGameOver && isMyTurn);

  // Action buttons gate.
  const drawOffer = game.drawOffer;
  const myOwnOffer = drawOffer && myColor && drawOffer.offeredBy === myColor;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column: opponent strip + board + me strip + controls */}
        <div className="flex flex-col gap-3">
          {/* Opponent strip */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-200">
                {opponent?.username ?? 'Opponent'}
              </span>
              {opponent && (
                <span className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 font-mono text-xs text-neon-400">
                  {opponent.elo}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {myColor && <CapturedPieces by={myColor === 'w' ? 'b' : 'w'} />}
              <GameTimer
                ms={myColor === 'w' ? blackMs : whiteMs}
                active={isMyTurn === false && !isGameOver}
                flagFallen={myColor === 'w' ? blackMs <= 0 : whiteMs <= 0}
              />
            </div>
          </div>

          {/* Board */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
            <Chessboard
              options={{
                id: 'game-room',
                position,
                onPieceDrop: submitMove,
                boardOrientation: orientation,
                allowDragging: canDrag,
                allowDrawingArrows: !isGameOver,
                arrows,
                squareStyles,
                animationDurationInMs: 200,
                showNotation: true,
              }}
            />
          </div>

          {/* Me strip */}
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
            <div className="flex items-center gap-3">
              {myColor && <CapturedPieces by={myColor} />}
              <GameTimer
                ms={myColor === 'w' ? whiteMs : blackMs}
                active={isMyTurn && !isGameOver}
                flagFallen={myColor === 'w' ? whiteMs <= 0 : blackMs <= 0}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                if (gameId) void game.resign();
              }}
              disabled={!gameId || isGameOver}
              className="rounded-lg border border-accent-rose/40 bg-accent-rose/10 px-4 py-2 text-sm font-semibold text-accent-rose transition hover:bg-accent-rose/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Resign
            </button>
            {drawOffer && !myOwnOffer ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (gameId) void game.acceptDraw();
                  }}
                  disabled={!gameId || isGameOver}
                  className="rounded-lg bg-neon-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-neon-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Accept draw
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (gameId) void game.declineDraw();
                  }}
                  disabled={!gameId || isGameOver}
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Decline draw
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (gameId) void game.offerDraw();
                }}
                disabled={!gameId || isGameOver || !!myOwnOffer}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {myOwnOffer ? 'Draw offered…' : 'Offer draw'}
              </button>
            )}
          </div>

          {game.lastAckError && game.lastAckError !== 'no_active_game' && (
            <p className="text-xs text-accent-rose">{game.lastAckError}</p>
          )}
        </div>

        {/* Right column: move list */}
        <div className="h-[60vh] lg:h-auto lg:max-h-[calc(100vh-9rem)]">
          <MoveListSidebar />
        </div>
      </div>

      {/* Overlays */}
      <PromotionDialog />
      <GameOverModal />
      {!snapshot && !isGameOver && <MatchmakingOverlay />}
    </main>
  );
}

/**
 * Wraps the room in the GameProvider so all child hooks share one context.
 *
 * No :id from params is required for the matchmaking flow (the user enters
 * via /game with no id, queues, and is navigated to /game/<gameId> on
 * `queue:matched`). A cold direct-URL hit to /game/<id> has no REST endpoint
 * to load the game from (the server only exposes an active-games list via the
 * `game:rejoined` socket event); we render the "Joining..." gate until the
 * first `game:state` lands. See ARCHITECTURE.md Step 9 for the gap.
 */
export function Game(): React.JSX.Element {
  return (
    <GameProvider>
      <GameRoom />
    </GameProvider>
  );
}
