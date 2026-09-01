/**
 * React context for authentication.
 *
 * The fetching, caching and error semantics all live in the shared session
 * query (src/utils/queries/session.ts) — this file is now just the context
 * shape plus the login/logout mutations. It used to own a fourth independent
 * copy of the `/api/auth/me` read; the point of routing it through the store
 * is that a page can mount this provider AND other islands AND an inline
 * script and still make one request, because the cache sits below React where
 * all three can reach it.
 *
 * `login`/`logout` publish their result straight into that store rather than
 * triggering a refetch: the response body IS the new session, and it is more
 * current than anything a follow-up GET could tell us.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useSession } from '../hooks/useSession';
import { setSession, type SessionUser } from '../utils/queries/session';

/** Re-exported so existing importers of AuthUser keep working. */
export type AuthUser = SessionUser;

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * Set by a failed login/logout, or by a session read that could not
   * complete. Note that a read failure is NOT a logged-out user — `user` keeps
   * the last known session so a dropped request doesn't sign anyone out.
   */
  error: string | null;
  login: (username: string, password: string, leagueId?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const login = useCallback(
    async (username: string, password: string, leagueId?: string) => {
      setMutating(true);
      setMutationError(null);
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password, leagueId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Login failed');
        setSession({ authenticated: true, user: data.user ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setMutationError(message);
        // A failed login says nothing new about the existing session, so the
        // store is left alone rather than being cleared to logged-out.
        throw err;
      } finally {
        setMutating(false);
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    setMutating(true);
    setMutationError(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      setSession({ authenticated: false, user: null });
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setMutating(false);
    }
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user: session.user,
      isAuthenticated: session.isAuthenticated,
      isLoading: session.isLoading || mutating,
      error: mutationError ?? (session.isError ? session.error?.message ?? null : null),
      login,
      logout,
    }),
    [session, mutating, mutationError, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
