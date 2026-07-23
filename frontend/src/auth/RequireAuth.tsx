/** Route guards (doc 25, WP4).
 *
 * `RequireAuth` gates the whole authenticated app: while the user is being
 * bootstrapped it shows a spinner, and a logged-out visitor is redirected to
 * /login (remembering where they wanted to go). `RequireAdmin` additionally
 * restricts a subtree to superusers.
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from './AuthContext'

function FullscreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50" role="status" aria-label="Lädt">
      <Loader2 className="animate-spin text-blue-600" size={28} />
    </div>
  )
}

export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()

  if (user === undefined) return <FullscreenSpinner />
  if (user === null) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}

export function RequireAdmin() {
  const { user } = useAuth()

  if (user === undefined) return <FullscreenSpinner />
  if (!user?.is_superuser) return <Navigate to="/calendar" replace />
  return <Outlet />
}
