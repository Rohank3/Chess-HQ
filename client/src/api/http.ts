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

http.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      clearAuth();
    }
    const body = error.response?.data as ApiError | undefined;
    return Promise.reject({
      status: error.response?.status ?? 0,
      code: body?.error ?? 'network_error',
      message: body?.message ?? error.message ?? 'Network error',
    });
  },
);
