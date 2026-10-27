import { createContext, useContext, type ReactNode } from 'react';

/** The signed-in session every screen needs: the token for `apiGet`, and how to sign out. */
export interface Session {
  token: string;
  signOut: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Only screens inside the signed-in navigator call this, so a missing session is a bug. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession() outside the signed-in app');
  return session;
}
