/** Client-side auth state (doc 25, WP4).
 *
 * Holds the current user, bootstrapped once from `GET /users/me`. The session
 * itself lives in the httpOnly cookie the backend sets — this context never sees
 * a token, it only mirrors "is someone logged in and who". A global
 * `auth:unauthorized` event (fired by the API layer on any 401) drops the user so
 * the route guard bounces to the login page when a session lapses mid-use.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, AUTH_UNAUTHORIZED_EVENT, type User } from '../api'

interface AuthState {
  /** undefined = still bootstrapping, null = logged out, User = logged in. */
  user: User | null | undefined
  /** Re-fetch the current user (after login/register). */
  refresh: () => Promise<User | null>
  /** Clear the server session and local user. */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  const refresh = useCallback(async () => {
    const me = await auth.me()
    setUser(me)
    return me
  }, [])

  const logout = useCallback(async () => {
    try {
      await auth.logout()
    } finally {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    // Bootstrap the session from the server on mount. setUser runs only after the
    // fetch resolves (inside refresh), so this is an async subscribe-to-external-
    // system effect, not a synchronous cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  // A 401 anywhere in the app means the session is gone — reflect that so the guard
  // redirects. Setting null is idempotent, so a stray event during bootstrap is safe.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  return <AuthContext.Provider value={{ user, refresh, logout }}>{children}</AuthContext.Provider>
}

// Colocated with the provider by design; fast-refresh only-components warning N/A.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
