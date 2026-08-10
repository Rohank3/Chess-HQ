import type { Socket } from 'socket.io-client';
import type { Ack } from './types';

/**
 * Wrap a socket.io emit-with-ack in a Promise.
 *
 * socket.io's `socket.emit(event, ...args, ackCb)` calls `ackCb` once the
 * server has run its handler and returned. Putting that into a Promise lets
 * the hooks treat acks as awaitable values (e.g. `const ack = await ...`)
 * rather than nesting callback pyramids.
 *
 * Rejects if the socket is null (defensive -- hooks may render before the
 * socket has bootstrapped). On a network failure socket.io invokes the ack
 * with an `Error`; we surface that as `{ ok:false, error:'network_error',
 * message:'Network error' }` so callers always see the typed `Ack` shape.
 */
export function emitWithAck(
  socket: Socket | null,
  event: string,
  payload: unknown,
): Promise<Ack> {
  if (!socket) {
    return Promise.resolve({ ok: false, error: 'no_connection', message: 'Not connected' });
  }
  return new Promise((resolve) => {
    socket.emit(event, payload, (ack: Ack | Error) => {
      if (ack instanceof Error) {
        resolve({ ok: false, error: 'network_error', message: ack.message ?? 'Network error' });
        return;
      }
      resolve(ack);
    });
  });
}

export function emitVoidWithAck(
  socket: Socket | null,
  event: string,
): Promise<Ack> {
  if (!socket) {
    return Promise.resolve({ ok: false, error: 'no_connection', message: 'Not connected' });
  }
  return new Promise((resolve) => {
    socket.emit(event, (ack: Ack | Error) => {
      if (ack instanceof Error) {
        resolve({ ok: false, error: 'network_error', message: ack.message ?? 'Network error' });
        return;
      }
      resolve(ack);
    });
  });
}
