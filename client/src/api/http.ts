import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    username: string;
    elo: number;
    isGuest: boolean;
  };
}

export interface MeResponse {
  user: {
    id: string;
    username: string;
    elo: number;
    isGuest: boolean;
  };
}

// POST /api/auth/guest returns the same shape as register/login but with a
// short-lived token and an is_guest=true user.
export type GuestAuthResponse = AuthResponse;

export type GameResult = 'win' | 'loss' | 'draw';

export interface RecentGame {
  id: string;
  endedAt: string;
  termination: string;
  timeControl: string;
  myColor: 'w' | 'b';
  opponent: { id: string; username: string };
  myEloBefore: number | null;
  myEloAfter: number | null;
  myResult: GameResult;
  eloDelta: number | null;
}

export interface StatsProfile {
  username: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface StatsResponse {
  profile: StatsProfile | null;
  recentGames: RecentGame[];
}

export interface ApiError {
  error: string;
  message?: string;
}

export const TOKEN_STORAGE_KEY = 'chesshq.token';
export const USER_STORAGE_KEY = 'chesshq.user';

/**
 * A `window` event dispatched after a successful token refresh, so React
 * (AuthContext) can synchronise its `token` state with the freshly-stored
 * localStorage token. Keeping this seam as a DOM event (rather than a
 * module-level callback registry) avoids importing React types into the
 * network module and lets any listener react without coupling.
 */
export const TOKEN_REFRESHED_EVENT = 'chesshq:token-refreshed';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAuth(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage can throw in private browsing or sandbox iframes; we degrade to in-memory.
  }
}

export function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // same as above
  }
}

const baseURL = import.meta.env.VITE_API_URL ?? '';

export const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- 401 → refresh → retry -----------------------------------------------
//
// A single in-flight refresh promise de-dupes concurrent 401s: when the
// bootstrap /me and the dashboard /api/stats/me both 401 at once, only the
// first request triggers a POST /api/auth/refresh; every concurrent 401
// awaits the same promise and retries with the single fresh token. The
// refresh endpoint and the three login/register/guest endpoints are
// explicitly excluded -- a 401 from those (bad credentials, an expired
// refresh bearer) must NOT recurse or retry, it must surface to the user.
//
// A request that fails after a successful refresh is tagged `_retried=true`
// and not retried again (no infinite refresh loop if the new token is also
// rejected). On a refresh failure we clear auth (the token is genuinely
// unusable) and reject with the normalised error so callers flash a sign-in
// prompt; we do NOT navigate here (http.ts is module-level, below React) --
// the toast/reload is owned by the consumer layer.

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let refreshing: Promise<string | null> | null = null;

const NON_REFRESH_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/guest', '/api/auth/refresh'];

function isRefreshable(config: InternalAxiosRequestConfig | undefined): boolean {
  const url = config?.url ?? '';
  // baseURL is '' in dev (proxied) or the API origin in prod; compare the
  // suffix so the check works in both.
  if (config?.baseURL && url.startsWith(config.baseURL)) {
    return !NON_REFRESH_PATHS.some((p) => url.slice(config.baseURL!.length) === p);
  }
  return !NON_REFRESH_PATHS.some((p) => url === p);
}

/**
 * Attempt a single token refresh against POST /api/auth/refresh using the
 * currently-stored bearer; resolves to the fresh token string on success or
 * `null` on any failure (clears auth on failure). Exported so the socket
 * layer can trigger a refresh on a `token_expired` connect_error and reconnect
 * with the fresh token, rather than going through a synthetic 401.
 *
 * Concurrent callers share the same in-flight promise.
 */
export function tryRefresh(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await http.post<AuthResponse>('/api/auth/refresh', {});
      const fresh = res.data.token;
      storeAuth(fresh);
      // Notify any React listener (AuthContext) so the in-memory token state
      // re-syncs and the socket re-handshakes with the fresh token.
      window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT));
      return fresh;
    } catch {
      clearAuth();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function normalizeError(error: unknown): { status: number; code: string; message: string } {
  const e = error as { response?: { status?: number; data?: ApiError }; message?: string };
  const status = e?.response?.status ?? 0;
  const body = e?.response?.data;
  return {
    status,
    code: body?.error ?? 'network_error',
    message: body?.message ?? e?.message ?? 'Network error',
  };
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as RetriableRequestConfig | undefined;

    if (status !== 401 || !config || !isRefreshable(config) || config._retried) {
      // Not a refreshable 401 (network error, non-auth 5xx, an auth-endpoint
      // 401, or a request that already retried after a refresh). Surface the
      // normalised error; if it's a 401 with no retry path, clear auth so the
      // next ProtectedRoute bounce sends the user to /login.
      if (status === 401) clearAuth();
      return Promise.reject(normalizeError(error));
    }

    const fresh = await tryRefresh();
    if (!fresh) {
      // Refresh failed (the bearer is genuinely unusable); the original 401
      // is the honest error.
      return Promise.reject(normalizeError(error));
    }

    // Re-dispatch the original request with the fresh token. The request
    // interceptor reads getStoredToken() fresh on each call, so the only
    // mutation needed is the _retried flag.
    config._retried = true;
    return http.request(config);
  },
);
