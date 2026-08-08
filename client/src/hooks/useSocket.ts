import { useEffect, useRef, useState } from 'react';
import { getSocket, disconnectSocket, type Socket } from '../socket/socket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export function useSocket(): { status: SocketStatus; socket: Socket | null } {
  const { token, logout } = useAuth();
  const { push } = useToast();
  const [status, setStatus] = useState<SocketStatus>('idle');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    const socket = getSocket();
    socketRef.current = socket;

    const onConnect = () => setStatus('open');
    const onDisconnect = () => setStatus('reconnecting');
    const onConnectError = (err: Error) => {
      setStatus('error');
      const reason = err.message;
      if (
        reason === 'missing_token' ||
        reason === 'invalid_token' ||
        reason === 'token_expired'
      ) {
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
      disconnectSocket();
    };
  }, [token, logout, push]);

  return { status, socket: socketRef.current };
}
