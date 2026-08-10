import { useEffect, useRef, useState } from 'react';
import { getSocket, disconnectSocket, type Socket } from '../socket/socket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { tryRefresh } from '../api/http';

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

// How long a disconnect can persist before we escalate from the small
// status pill to a persistent warning toast. Chosen to be longer than the
// socket.io reconnect backoff's initial delay (1s) but shorter than the
// max (5s) -- so a transient blip stays silent and only a real outage
// surfaces the banner.
const LONG_DISCONNECT_MS = 4_000;

export function useSocket(): { status: SocketStatus; socket: Socket | null } {
  const { token, logout } = useAuth();
  const { push } = useToast();
  const [status, setStatus] = useState<SocketStatus>('idle');
  const socketRef = useRef<Socket | null>(null);
  const longDisconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedLongDisconnect = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    const socket = getSocket();
    socketRef.current = socket;

    const clearLongDisconnect = () => {
      if (longDisconnectTimer.current) {
        clearTimeout(longDisconnectTimer.current);
        longDisconnectTimer.current = null;
      }
    };

    const onConnect = () => {
      setStatus('open');
      clearLongDisconnect();
      warnedLongDisconnect.current = false;
    };
    const onDisconnect = () => {
      setStatus('reconnecting');
      // Escalate to a persistent banner toast if we're still disconnected
      // past LONG_DISCONNECT_MS. The small status pill shows "Reconnecting…"
      // immediately; this toast is the "it's been a while, we're still on it"
      // signal for a real outage. Auto-cleared by the next onConnect via the
      // toast's own dismissal, but we also reset the warned flag on connect
      // so a later disconnect re-escalates.
      clearLongDisconnect();
      if (!warnedLongDisconnect.current) {
        longDisconnectTimer.current = setTimeout(() => {
          warnedLongDisconnect.current = true;
          push('warn', 'You are disconnected from the server. Reconnecting…');
        }, LONG_DISCONNECT_MS);
      }
    };
    const onConnectError = async (err: Error) => {
      setStatus('error');
      const reason = err.message;
      if (reason === 'token_expired') {
        // The access token expired. Rather than hard-logging-out (the
        // prior Step-9 behaviour), attempt a single refresh; on success
        // the TOKEN_REFRESHED_EVENT fires and this effect re-runs (its
        // dep is `token`), tearing down the errored socket and mounting a
        // fresh one with the new bearer. On refresh failure, fall back to
        // the honest logout -- the session is gone.
        const fresh = await tryRefresh();
        if (!fresh) {
          push('warn', 'Session expired — please sign in again.');
          logout();
        }
      } else if (reason === 'missing_token' || reason === 'invalid_token') {
        push('warn', 'Session expired — please sign in again.');
        logout();
      } else {
        push('error', 'Unable to reach the server. Retrying...');
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      clearLongDisconnect();
      disconnectSocket();
    };
  }, [token, logout, push]);

  return { status, socket: socketRef.current };
}
