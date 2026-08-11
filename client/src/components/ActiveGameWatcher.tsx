import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { emitWithAck } from '../game/emit';
import type { ChallengeAcceptedPayload, RejoinedPayload } from '../game/types';

/**
 * App-wide game adoption, mounted once under AuthProvider so it is alive on
 * EVERY page -- not just the /game routes. The game-room flows (queue match,
 * challenge accept while sitting on the hub) are handled inside GameProvider;
 * this watcher covers the cases where the player is anywhere else:
 *
 *   - a challenge was accepted while the creator was on the dashboard / home
 *     page (GameProvider isn't mounted there, so its `challenge:accepted`
 *     listener never saw the event). We hear it here and navigate into the
 *     room; GameProvider rebuilds colour + opponent from the game:subscribe
 *     ack.
 *   - the socket (re)connected and the server pushed `game:rejoined` with
 *     the user's active games -- adopt the newest so a reload or a dropped
 *     connection mid-game lands the player back on their board instead of
 *     stranding them on the hub.
 *   - on connect we also PULL `game:active`, because `game:rejoined` is only
 *     pushed on a fresh socket connection: a player who stayed connected
 *     while a challenge was accepted and then navigates back to /game has no
 *     reconnect event to rely on.
 *
 * Adoption is idempotent: navigating to the same /game/:id with `replace`
 * when already there is a no-op, so this never fights GameProvider.
 */
export function ActiveGameWatcher(): null {
  const { socket } = useSocket();
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;

    const adopt = (gameId: string) => {
      navigate(`/game/${gameId}`, { replace: true });
    };

    const onRejoined = (payload: RejoinedPayload) => {
      const newest = payload.games?.[0];
      if (newest?.gameId) adopt(newest.gameId);
    };

    const onAccepted = (payload: ChallengeAcceptedPayload) => {
      if (payload.gameId) adopt(payload.gameId);
    };

    // Pull the newest active game once connected. The server orders by
    // started_at DESC, so the first entry is the one to resume.
    const pullActive = () => {
      void emitWithAck(socket, 'game:active', {}).then((ack) => {
        const games = (ack as { games?: { gameId: string }[] }).games;
        if (ack.ok && games && games.length > 0) adopt(games[0]!.gameId);
      });
    };

    socket.on('game:rejoined', onRejoined);
    socket.on('challenge:accepted', onAccepted);
    socket.on('connect', pullActive);
    if (socket.connected) pullActive();

    return () => {
      socket.off('game:rejoined', onRejoined);
      socket.off('challenge:accepted', onAccepted);
      socket.off('connect', pullActive);
    };
  }, [socket, navigate]);

  return null;
}
