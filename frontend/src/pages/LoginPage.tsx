/** Login screen (doc 25, WP4).
 *
 * Posts credentials to the cookie-auth backend, then re-bootstraps the user and
 * returns to wherever the guard sent them from (or the calendar). An
 * already-authenticated visitor is bounced straight in.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { auth, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import AuthLayout from '../auth/AuthLayout'

interface FromState { from?: { pathname?: string } }

export default function LoginPage() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const target = (location.state as FromState | null)?.from?.pathname ?? '/calendar'

  // Already logged in? Don't show the form.
  if (user) return <Navigate to={target} replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await auth.login(email.trim(), password)
      const me = await refresh()
      if (me) navigate(target, { replace: true })
      else setError('Anmeldung fehlgeschlagen.')
    } catch (err) {
      // fastapi-users returns 400 LOGIN_BAD_CREDENTIALS for wrong email/password.
      if (err instanceof ApiError && err.status === 400) {
        setError('E-Mail oder Passwort ist falsch.')
      } else {
        setError('Anmeldung fehlgeschlagen. Bitte später erneut versuchen.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Anmelden" subtitle="Melde dich mit deinem Konto an.">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-xs font-medium text-gray-600">E-Mail</label>
          <input
            id="login-email" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-gray-600">Passwort</label>
          <input
            id="login-password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <button
          type="submit" disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Anmelden
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-gray-500">
        Noch kein Konto?{' '}
        <Link to="/register" className="font-medium text-blue-600 hover:underline">Mit Einladung registrieren</Link>
      </p>
    </AuthLayout>
  )
}
