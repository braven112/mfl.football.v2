/**
 * useSession — the React view of the shared session query.
 *
 * Every island that needs "who is logged in?" should use this rather than its
 * own `/api/auth/me` effect: they then share one request and one answer per
 * page, across React roots. See src/utils/queries/session.ts.
 */

import { sessionQuery, type SessionSnapshot, type SessionUser } from '../utils/queries/session';
import { useSharedQuery, type UseSharedQueryOptions } from './useSharedQuery';

export interface SessionResult {
  user: SessionUser | null;
  /** True only when the server confirmed a signed-in user. */
  isAuthenticated: boolean;
  /** First load in flight — the session is not yet known either way. */
  isLoading: boolean;
  /**
   * The session could not be READ. Distinct from `isAuthenticated === false`,
   * which is a confirmed "nobody is signed in". Do not sign a user out of the
   * UI on this; it is usually a dropped request.
   */
  isError: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useSession(options: UseSharedQueryOptions = {}): SessionResult {
  const { data, isLoading, isError, error, refresh } = useSharedQuery<void, SessionSnapshot>(
    sessionQuery,
    undefined,
    options,
  );
  return {
    user: data?.user ?? null,
    isAuthenticated: data?.authenticated === true,
    isLoading,
    isError,
    error,
    refresh,
  };
}
