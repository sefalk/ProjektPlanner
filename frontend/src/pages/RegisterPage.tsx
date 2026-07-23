/** Registration screen (doc 25, WP4).
 *
 * Self-service sign-up gated by a one-time invite token. On success the user is
 * logged straight in (registration alone does not create a session) and dropped
 * into the app. Backend 400s (bad/used/expired token, weak password, duplicate
 * e-mail) are mapped to readable German messages.
 */
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { auth, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import AuthLayout from '../auth/AuthLayout'
import PasswordChecklist from '../components/PasswordChecklist'
import { isPasswordValid } from '../lib/passwordPolicy'

/** Turn a fastapi-users / invite 400 body into a German message. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    const detail = (err.body as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string') {
      if (detail === 'REGISTER_USER_ALREADY_EXISTS') return 'Für diese E-Mail existiert bereits ein Konto.'
      // Invite-token errors arrive as descriptive English strings.
      const map: Record<string, string> = {
        'An invite token is required to register.': 'Ein Einladungs-Token ist zur Registrierung erforderlich.',
        'Invalid invite token.': 'Ungültiges Einladungs-Token.',
        'This invite token has already been used.': 'Dieses Einladungs-Token wurde bereits verwendet.',
        'This invite token has expired.': 'Dieses Einladungs-Token ist abgelaufen.',
      }
      return map[detail] ?? detail
    }
    if (detail && typeof detail === 'object' && 'code' in detail) {
      const code = (detail as { code?: string }).code
      const reason = (detail as { reason?: string }).reason
      if (code === 'REGISTER_INVALID_PASSWORD') {
        return `Passwort zu schwach${reason ? `: ${reason}` : '.'}`
      }
    }
  }
  return 'Registrierung fehlgeschlagen. Bitte Eingaben prüfen.'
}

export default function RegisterPage() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(params.get('token') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/calendar" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await auth.register({ email: email.trim(), password, invite_token: token.trim() })
      // Registration does not open a session — log in with the same credentials.
      await auth.login(email.trim(), password)
      const me = await refresh()
      navigate(me ? '/calendar' : '/login', { replace: true })
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Registrieren" subtitle="Erstelle ein Konto mit deinem Einladungs-Token.">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="reg-email" className="mb-1 block text-xs font-medium text-gray-600">E-Mail</label>
          <input
            id="reg-email" type="email" autoComplete="username" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="reg-password" className="mb-1 block text-xs font-medium text-gray-600">Passwort</label>
          <input
            id="reg-password" type="password" autoComplete="new-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <PasswordChecklist password={password} />
        </div>
        <div>
          <label htmlFor="reg-token" className="mb-1 block text-xs font-medium text-gray-600">Einladungs-Token</label>
          <input
            id="reg-token" type="text" required
            value={token} onChange={(e) => setToken(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <button
          type="submit" disabled={busy || !isPasswordValid(password)}
          className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Konto erstellen
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-gray-500">
        Bereits registriert?{' '}
        <Link to="/login" className="font-medium text-blue-600 hover:underline">Anmelden</Link>
      </p>
    </AuthLayout>
  )
}
