import { useCallback, useEffect, useState } from 'react';
import { http, type StatsResponse } from '../api/http';

export interface StatsApiError {
  code: string;
  message: string;
}

export interface UseStatsResult {
  data: StatsResponse | null;
  loading: boolean;
  error: StatsApiError | null;
  refresh: () => void;
}

/**
 * Loads the signed-in user's dashboard read: profile (elo, w/l/d) plus a
 * page of recent games. A single GET /api/stats/me -- no fan-out, the
 * server shapes the whole payload in one query. Re-fetched on demand via
 * `refresh()` (used by the dashboard's "retry" affordance on a load error).
 */
export function useStats(): UseStatsResult {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<StatsApiError | null>(null);
  const [nonce, setNonce] = useState<number>(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    http
      .get<StatsResponse>('/api/stats/me')
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setError(null);
      })
      .catch((err: StatsApiError) => {
        if (cancelled) return;
        setData(null);
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { data, loading, error, refresh };
}
