/**
 * The league, and the account's team in it, that the "manage your team"
 * screens act on (My Team, Players, Chat, Set lineup, Waivers, Trades…).
 *
 * The list comes from `/api/mfl-live/my-teams`; the choice is remembered on
 * the device so the app reopens on the same league. The server never trusts
 * the league id the app sends: every `/api/mfl-live/*` endpoint re-checks it
 * against the owner's own MFL account.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { MflLiveAppMyTeam, MflLiveAppMyTeamsResponse } from '@mfl/shared-types/mfl-live-app-teams';
import { apiGet, SignedOutError } from './api';
import { useSession } from './session-context';

export interface ActiveTeam {
  /** The team the screens act as; null while loading, or when the account has none. */
  team: MflLiveAppMyTeam | null;
  teams: MflLiveAppMyTeam[];
  loading: boolean;
  error: string | null;
  selectLeague: (leagueId: string) => void;
  reload: () => void;
}

/** Not a secret, but SecureStore is the store the app already ships. */
const KEY = 'mfl-football-active-league';

const ActiveTeamContext = createContext<ActiveTeam | null>(null);

export function ActiveTeamProvider({ children }: { children: ReactNode }) {
  const { token, signOut } = useSession();
  const [teams, setTeams] = useState<MflLiveAppMyTeam[]>([]);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
      try {
        const body = await apiGet<MflLiveAppMyTeamsResponse>(token, '/api/mfl-live/my-teams');
        if (cancelled) return;
        if (!body.ok) throw new Error('teams-unavailable');
        setTeams(body.teams);
        setError(null);
        setLeagueId((current) => {
          const want = current ?? saved;
          return body.teams.some((t) => t.leagueId === want) ? want : body.teams[0]?.leagueId ?? null;
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof SignedOutError) {
          signOut();
          return;
        }
        // Keep whatever list we already had; the screens say why it may be stale.
        setError('Could not load your leagues. Pull to try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, signOut, attempt]);

  const selectLeague = useCallback((id: string) => {
    setLeagueId(id);
    SecureStore.setItemAsync(KEY, id).catch(() => undefined);
  }, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<ActiveTeam>(
    () => ({
      team: teams.find((t) => t.leagueId === leagueId) ?? null,
      teams,
      loading,
      error,
      selectLeague,
      reload,
    }),
    [teams, leagueId, loading, error, selectLeague, reload],
  );
  return <ActiveTeamContext.Provider value={value}>{children}</ActiveTeamContext.Provider>;
}

/** Only screens inside the signed-in navigator call this, so a missing provider is a bug. */
export function useActiveTeam(): ActiveTeam {
  const value = useContext(ActiveTeamContext);
  if (!value) throw new Error('useActiveTeam() outside the signed-in app');
  return value;
}
