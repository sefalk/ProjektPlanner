/** Account self-service (doc 25, #53).
 *
 * Lets the logged-in user change their e-mail and password. The backend
 * (`PATCH /users/me`) does not re-check the current password, so we verify it
 * client-side by re-logging-in before applying a change — a wrong current
 * password is rejected before anything is sent. The password field mirrors the
 * shared policy checklist; the backend enforces it authoritatively. */
import { useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck, Mail, KeyRound, CheckCircle } from 'lucide-react'
import { auth, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import { isPasswordValid } from '../lib/passwordPolicy'
import PasswordChecklist from '../components/PasswordChecklist'
import PageHeader from '../components/PageHeader'

/** Map a fastapi-users update 400 to a German message. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    const detail = (err.body as { detail?: unknown } | null)?.detail
    if (detail === 'UPDATE_USER_EMAIL_ALREADY_EXISTS') return 'Diese E-Mail wird bereits verwendet.'
    if (detail && typeof detail === 'object' && 'code' in detail) {
      const reason = (detail as { reason?: string }).reason
      if ((detail as { code?: string }).code === 'UPDATE_USER_INVALID_PASSWORD') {
        return `Passwort zu schwach${reason ? `: ${reason}` : '.'}`
      }
    }
  }
  return 'Änderung fehlgeschlagen. Bitte Eingaben prüfen.'
}

const inputClass =
  'w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      <div className="bg-white rounded-lg border border-gray-200 px-6 py-4">{children}</div>
    </section>
  )
}

function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={`mt-3 flex items-center gap-1.5 rounded border px-3 py-2 text-xs ${
        ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      {ok && <CheckCircle size={13} />}
      {msg}
    </p>
  )
}

export default function AccountPage() {
  const { user, refresh } = useAuth()

  // ── Change e-mail ──
  const [newEmail, setNewEmail] = useState(user?.email ?? '')
  const [emailPw, setEmailPw] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailFeedback, setEmailFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Change password ──
  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwFeedback, setPwFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  if (!user) return null

  /** Verify the supplied current password by re-authenticating. */
  const verifyCurrent = async (password: string): Promise<boolean> => {
    try {
      await auth.login(user.email, password)
      return true
    } catch {
      return false
    }
  }

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault()
    setEmailFeedback(null)
    const email = newEmail.trim()
    if (email === user.email) {
      setEmailFeedback({ ok: false, msg: 'Das ist bereits deine aktuelle E-Mail.' })
      return
    }
    setEmailBusy(true)
    try {
      if (!(await verifyCurrent(emailPw))) {
        setEmailFeedback({ ok: false, msg: 'Aktuelles Passwort ist falsch.' })
        return
      }
      await auth.updateMe({ email })
      await refresh()
      setEmailPw('')
      setEmailFeedback({ ok: true, msg: 'E-Mail aktualisiert.' })
    } catch (err) {
      setEmailFeedback({ ok: false, msg: messageFor(err) })
    } finally {
      setEmailBusy(false)
    }
  }

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwFeedback(null)
    if (!isPasswordValid(newPw)) {
      setPwFeedback({ ok: false, msg: 'Das neue Passwort erfüllt die Anforderungen nicht.' })
      return
    }
    if (newPw !== newPw2) {
      setPwFeedback({ ok: false, msg: 'Die beiden neuen Passwörter stimmen nicht überein.' })
      return
    }
    setPwBusy(true)
    try {
      if (!(await verifyCurrent(curPw))) {
        setPwFeedback({ ok: false, msg: 'Aktuelles Passwort ist falsch.' })
        return
      }
      await auth.updateMe({ password: newPw })
      setCurPw(''); setNewPw(''); setNewPw2('')
      setPwFeedback({ ok: true, msg: 'Passwort geändert.' })
    } catch (err) {
      setPwFeedback({ ok: false, msg: messageFor(err) })
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Konto" subtitle="E-Mail und Passwort deines Zugangs verwalten" />
      <div className="p-6 space-y-8 max-w-2xl">

        {/* Identity */}
        <Card icon={<ShieldCheck size={15} className="text-gray-400" />} title="Zugang">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Angemeldet als</p>
              <p className="text-sm font-medium text-gray-800">{user.email}</p>
            </div>
            {user.is_superuser && (
              <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 border border-blue-200">
                <ShieldCheck size={12} /> Administrator
              </span>
            )}
          </div>
        </Card>

        {/* Change e-mail */}
        <Card icon={<Mail size={15} className="text-gray-400" />} title="E-Mail ändern">
          <form onSubmit={submitEmail} className="space-y-3">
            <div>
              <label htmlFor="acc-email" className="mb-1 block text-xs font-medium text-gray-600">Neue E-Mail</label>
              <input id="acc-email" type="email" autoComplete="email" required value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="acc-email-pw" className="mb-1 block text-xs font-medium text-gray-600">Aktuelles Passwort</label>
              <input id="acc-email-pw" type="password" autoComplete="current-password" required value={emailPw}
                onChange={(e) => setEmailPw(e.target.value)} className={inputClass} />
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={emailBusy}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {emailBusy && <Loader2 size={14} className="animate-spin" />}
                E-Mail speichern
              </button>
            </div>
            {emailFeedback && <Feedback ok={emailFeedback.ok} msg={emailFeedback.msg} />}
          </form>
        </Card>

        {/* Change password */}
        <Card icon={<KeyRound size={15} className="text-gray-400" />} title="Passwort ändern">
          <form onSubmit={submitPassword} className="space-y-3">
            <div>
              <label htmlFor="acc-cur-pw" className="mb-1 block text-xs font-medium text-gray-600">Aktuelles Passwort</label>
              <input id="acc-cur-pw" type="password" autoComplete="current-password" required value={curPw}
                onChange={(e) => setCurPw(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="acc-new-pw" className="mb-1 block text-xs font-medium text-gray-600">Neues Passwort</label>
              <input id="acc-new-pw" type="password" autoComplete="new-password" required value={newPw}
                onChange={(e) => setNewPw(e.target.value)} className={inputClass} />
              <PasswordChecklist password={newPw} />
            </div>
            <div>
              <label htmlFor="acc-new-pw2" className="mb-1 block text-xs font-medium text-gray-600">Neues Passwort wiederholen</label>
              <input id="acc-new-pw2" type="password" autoComplete="new-password" required value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)} className={inputClass} />
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={pwBusy || !isPasswordValid(newPw)}
                className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {pwBusy && <Loader2 size={14} className="animate-spin" />}
                Passwort speichern
              </button>
            </div>
            {pwFeedback && <Feedback ok={pwFeedback.ok} msg={pwFeedback.msg} />}
          </form>
        </Card>

      </div>
    </div>
  )
}
