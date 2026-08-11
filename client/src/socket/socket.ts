import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from '../api/http';

/**
 * The socket is a process-wide singleton shared by every `useSocket`
 * consumer (Navbar, ConnectionStatus, matchmaking, the game room). A naive
 * "create on demand, destroy on unmount" lifecycle breaks the moment TWO
 * consumers are mounted at once: the first one to unmount would tear the
 * connection out from under the others (listeners removed, socket
 * disconnected, singleton nulled). That is exactly what used to happen when
 * the matchmaking hub unmounted the instant a game started -- the game room
 * then emitted `game:subscribe` into a dead socket and the clock sat at
 * 0:00 forever.
 *
 * So the singleton is reference-counted: `getSocket()` bumps the count and
 * creates/connects lazily; `releaseSocket()` drops it and only tears the
 * connection down when the LAST consumer lets go. `disconnectSocket()`
 * (logout) remains a hard, immediate teardown regardless of the count.
 */
let socket: Socket | null = null;
let refCount = 0;

function createSocket(): Socket {
  const url = import.meta.env.VITE_SOCKET_URL ?? '';

  return io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    auth: (cb) => {
      const token = getStoredToken();
      if (!token) {
        cb(new Error('missing_token'));
        return;
      }
      cb({ token });
    },
    autoConnect: false,
  });
}

/** Acquire the shared socket (creating + connecting it on first use). */
export function getSocket(): Socket {
  refCount += 1;
  if (!socket) socket = createSocket();
  if (!socket.connected && !socket.active) socket.connect();
  return socket;
}

/** Release one consumer's reference; tears down only when none remain. */
export function releaseSocket(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0 || !socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/** Hard teardown (logout / session end): kill the socket immediately. */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  refCount = 0;
}

export type { Socket };
