import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * App-wide "something is live right now" flags, reported by GameProvider and
 * consumed by the Navbar so the badge follows the player wherever they are.
 * GameProvider can't own this itself because it only mounts on the /game
 * routes, while the Navbar renders on every protected page.
 *
 * GameProvider is responsible for clearing both flags when it unmounts, so a
 * player who leaves /game for the dashboard never sees a stale badge.
 */
interface ActivityContextValue {
  /** Inside a live (not yet finished) game. */
  inGame: boolean;
  /** Waiting in the ranked matchmaking queue. */
  searching: boolean;
  setInGame: (v: boolean) => void;
  setSearching: (v: boolean) => void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [inGame, setInGame] = useState(false);
  const [searching, setSearching] = useState(false);

  const value = useMemo<ActivityContextValue>(
    () => ({ inGame, searching, setInGame, setSearching }),
    [inGame, searching],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity must be used inside an ActivityProvider');
  return ctx;
}
