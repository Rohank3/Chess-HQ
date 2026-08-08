import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from '../api/http';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) {
    socket.connect();
    return socket;
  }

  const url = import.meta.env.VITE_SOCKET_URL ?? '';

  socket = io(url, {
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

  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export type { Socket };
