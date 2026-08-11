import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  http,
  storeAuth,
  clearAuth,
  getStoredToken,
  TOKEN_REFRESHED_EVENT,
  type AuthResponse,
  type GuestAuthResponse,
  type MeResponse,
} from '../api/http';
import { disconnectSocket } from '../socket/socket';

export interface AuthUser {
  id: string;
  username: string;
  elo: number;
  isGuest: boolean;
  /** True once the account's email is confirmed (enables password recovery).
   *  Guests are always false — they have no email. */
  emailVerified: boolean;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string | null, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    const existing = getStoredToken();
    if (!existing) {
      setLoading(false);
      return;
    }
    http
      .get<MeResponse>('/api/auth/me')
      .then((res) => {
        if (cancelled) return;
        setUser(res.data.user);
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync React `token` state after a token refresh dispatched by the axios
  // interceptor (or by the socket layer's token_expired refresh path). The
  // interceptor writes the fresh token to localStorage and dispatches
  // TOKEN_REFRESHED_EVENT; this listener reads it back into state so
  // `useSocket`'s `token` dependency re-runs and reconnects with the new
  // bearer. Without this, HTTP recovers transparently but the socket stays
  // on the stale token and loops connect_error → logout. The interceptor
  // handles token refresh for HTTP calls; this bridge propagates the result
  // to the rest of the React tree.
  useEffect(() => {
    const onRefreshed = () => {
      const fresh = getStoredToken();
      setToken(fresh);
    };
    window.addEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, onRefreshed);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await http.post<AuthResponse>('/api/auth/login', {
      identifier,
      password,
    });
    storeAuth(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const register = useCallback(
    async (username: string, email: string | null, password: string) => {
      const res = await http.post<AuthResponse>('/api/auth/register', {
        username,
        email,
        password,
      });
      storeAuth(res.data.token);
      setToken(res.data.token);
      setUser(res.data.user);
    },
    [],
  );

  const loginAsGuest = useCallback(async () => {
    const res = await http.post<GuestAuthResponse>('/api/auth/guest', {});
    storeAuth(res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, register, loginAsGuest, logout }),
    [user, token, loading, login, register, loginAsGuest, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
