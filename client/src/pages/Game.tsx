import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { GameProvider, useGameContext } from '../context/GameContext';
import { GameTimer } from '../components/GameTimer';
import { CapturedPieces } from '../components/CapturedPieces';
import { MoveListSidebar } from '../components/MoveListSidebar';
import { PromotionDialog } from '../components/PromotionDialog';
import { MatchmakingHub } from '../components/MatchmakingHub';
import { GameOverModal } from '../components/GameOverModal';
import { useTimer } from '../game/useTimer';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LAST_MOVE_HIGHLIGHT = 'var(--color-neon-500)';
const LAST_MOVE_FROM_BG = 'rgba(6, 182, 212, 0.28)';
const LAST_MOVE_TO_BG = 'rgba(6, 182, 212, 0.45)';
const SELECTED_BG = 'rgba(34, 211, 238, 0.32)';
const MOVE_TARGET_BG = 'rgba(16, 185, 129, 0.25)';
const CAPTURE_TARGET_BG = 'rgba(244, 63, 94, 0.30)';

/**
 * Returns the FEN piece character on a square (uppercase = white, lowercase =
 * black), or '' for an empty square. Click-to-move needs it because
 * onPieceClick only reports the clicked square, while submitMove wants the
 * moving piece's type (to detect promotions).
 */
function pieceTypeAt(fen: string, square: string): string {
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - Number(square[1]);
  const row = fen.split(' ')[0]!.split('/')[rank];
  if (!row) return '';
  let idx = 0;
  for (const ch of row) {
    if (ch >= '1' && ch <= '8') {
      idx += Number(ch);
    } else {
      if (idx === file) return ch;
      idx += 1;
    }
  }
  return '';
}

function GameRoom(): React.JSX.Element {
  const { optimisticFen, gameId, myColor, opponent, game, matchmaking, submitMove, legalMovesFrom } =
    useGameContext();

  // A rejected game:subscribe (forbidden / internal error) with no snapshot
  // means the room cannot load at all -- show that instead of a board with
  // 0:00 clocks.
  if (game.subscribeError && !game.snapshot && !game.gameOver) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6">
        <div className="w-full rounded-2xl border border-accent-rose/40 bg-accent-rose/10 p-8 text-center">
          <h1 className="text-lg font-semibold text-accent-rose">Couldn't open this game</h1>
          <p className="mt-2 text-sm text-slate-300">{game.subscribeError}</p>
        </div>
      </main>
    );
  }

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

  // --- Legal-move highlighting + click-to-move -------------------------------
  // Clicking one of my pieces lights up every square it can legally move to
  // (green tint for quiet moves, rose ring for captures). With a piece
  // selected, clicking one of those highlighted targets makes the move — drag
  // still works too. Clicking the selected piece again deselects it.
  //
  // This is wired to onSquareClick (not onPieceClick): react-chessboard only
  // fires onPieceClick when the clicked square holds a piece, so a click on an
  // empty target square would never submit the move. The piece's own click
  // bubbles up to its square, so one handler covers both cases with a single
  // code path.
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSelectedSquare(null);
    setLegalTargets({});
  }, [snapshot]);

  const handleSquareClick = useCallback(
    ({ square }: { square: string | null }) => {
      if (!square) return;
      const myTurn = snapshot?.turn === myColor;
      if (!snapshot || isGameOver || !myColor || !myTurn) {
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      // Click-to-move: with a piece selected, clicking one of its highlighted
      // targets submits the move. The piece type is read off the rendered FEN;
      // promotion is caught by submitMove (opens the dialog, no snap-back).
      // Note: the map values are `isCapture`, which is false for quiet moves,
      // so test key presence, not truthiness.
      if (selectedSquare && Object.hasOwn(legalTargets, square)) {
        submitMove({
          piece: { pieceType: pieceTypeAt(position, selectedSquare) },
          sourceSquare: selectedSquare,
          targetSquare: square,
        });
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      // Clicking the selected piece again deselects it.
      if (selectedSquare === square) {
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      const moves = legalMovesFrom(square);
      if (moves.length === 0) {
        setSelectedSquare(null);
        setLegalTargets({});
        return;
      }
      setSelectedSquare(square);
      const targets: Record<string, boolean> = {};
      for (const m of moves) targets[m.to] = m.isCapture;
      setLegalTargets(targets);
    },
    [snapshot, isGameOver, myColor, legalMovesFrom, position, selectedSquare, legalTargets, submitMove],
  );

  const squareStyles = useMemo<Record<string, React.CSSProperties>>(() => {
    const out: Record<string, React.CSSProperties> = {};
    if (snapshot?.lastMove) {
      out[snapshot.lastMove.from] = { background: LAST_MOVE_FROM_BG };
      out[snapshot.lastMove.to] = { background: LAST_MOVE_TO_BG };
    }
    if (selectedSquare) {
      out[selectedSquare] = {
        background: SELECTED_BG,
        boxShadow: 'inset 0 0 0 2px var(--color-neon-500)',
      };
    }
    for (const [square, isCapture] of Object.entries(legalTargets)) {
      out[square] = isCapture
        ? { background: CAPTURE_TARGET_BG, boxShadow: 'inset 0 0 0 2px var(--color-accent-rose)' }
        : { background: MOVE_TARGET_BG };
    }
    return out;
  }, [snapshot, selectedSquare, legalTargets]);

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

  const orientation: 'white' | 'black' = myColor === 'b' ? 'black' : 'white';
  const isMyTurn = snapshot?.turn === myColor;
  const canDrag = !!(myColor && snapshot && !isGameOver && isMyTurn);

  const drawOffer = game.drawOffer;
  const myOwnOffer = drawOffer && myColor && drawOffer.offeredBy === myColor;

  // No game yet (neither matched nor challenge-adopted): show the hub — the
  // pre-game screen with standard time controls and challenge creation —
  // instead of an empty board with no explanation.
  if (!snapshot && !isGameOver && matchmaking.queueState !== 'matched' && !gameId) {
    return <MatchmakingHub />;
  }

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
              {!isGameOver && snapshot && !isMyTurn && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-500/30 bg-neon-500/10 px-2 py-0.5 text-[11px] font-medium text-neon-400">
                  <span className="size-1 rounded-full bg-neon-400" aria-hidden />
                  Opponent to move
                </span>
              )}
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
                onSquareClick: handleSquareClick,
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
            {!isGameOver && snapshot && isMyTurn && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-500/30 bg-neon-500/10 px-2 py-0.5 text-[11px] font-medium text-neon-400">
                <span
                  className="size-1 rounded-full bg-neon-400 shadow-[0_0_6px_1px_var(--color-neon-400)]"
                  aria-hidden
                />
                Your move
              </span>
            )}
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
    </main>
  );
}

/**
 * Wraps the room in the GameProvider so all child hooks share one context.
 * Game adoption (queue match or accepted challenge) sets the game identity in
 * the provider; the provider navigates to /game/<id> once adopted.
 */
export function Game(): React.JSX.Element {
  return (
    <GameProvider>
      <GameRoom />
    </GameProvider>
  );
}
