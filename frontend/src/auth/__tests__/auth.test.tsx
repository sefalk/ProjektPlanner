import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuthProvider } from '../AuthContext'
import { RequireAuth, RequireAdmin } from '../RequireAuth'
import LoginPage from '../../pages/LoginPage'
import { auth, AUTH_UNAUTHORIZED_EVENT } from '../../api'

const USER = { id: 1, email: 'a@b.c', is_active: true, is_superuser: false, is_verified: true }
const ADMIN = { ...USER, id: 2, email: 'admin@b.c', is_superuser: true }

/** Mutable session the fake backend reflects through /users/me. */
let session: typeof USER | null = null

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response
}

function installFetch(impl?: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (impl) return impl(url, init)
    if (url.endsWith('/users/me')) return session ? jsonRes(200, session) : jsonRes(401, { detail: 'Unauthorized' })
    if (url.endsWith('/auth/login')) {
      const body = String(init?.body ?? '')
      if (body.includes('username=a%40b.c') && body.includes('password=secret')) {
        session = USER
        return { ok: true, status: 204, text: async () => '', json: async () => undefined } as Response
      }
      return jsonRes(400, { detail: 'LOGIN_BAD_CREDENTIALS' })
    }
    if (url.endsWith('/auth/logout')) {
      session = null
      return { ok: true, status: 204, text: async () => '', json: async () => undefined } as Response
    }
    return jsonRes(404, {})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => { session = null })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ── API layer ────────────────────────────────────────────────────────────────

describe('auth api', () => {
  it('me() returns null on 401 without raising the re-auth event', async () => {
    installFetch()
    const spy = vi.fn()
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, spy)
    expect(await auth.me()).toBeNull()
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, spy)
    expect(spy).not.toHaveBeenCalled()
  })

  it('login() form-encodes username/password', async () => {
    const fn = installFetch()
    await auth.login('a@b.c', 'secret')
    const [, init] = fn.mock.calls[0]
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(String(init?.body)).toContain('username=a%40b.c')
  })
})

// ── Route guards ───────────────────────────────────────────────────────────────

function renderGuarded(initial: string, guard: 'auth' | 'admin') {
  const Guard = guard === 'auth' ? RequireAuth : RequireAdmin
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          <Route path="/calendar" element={<div>CALENDAR</div>} />
          <Route element={<Guard />}>
            <Route path="/secret" element={<div>SECRET CONTENT</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('redirects an unauthenticated visitor to /login', async () => {
    installFetch()
    renderGuarded('/secret', 'auth')
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument()
  })

  it('renders the protected content for an authenticated user', async () => {
    session = USER
    installFetch()
    renderGuarded('/secret', 'auth')
    expect(await screen.findByText('SECRET CONTENT')).toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  it('sends a non-admin back to /calendar', async () => {
    session = USER
    installFetch()
    renderGuarded('/secret', 'admin')
    expect(await screen.findByText('CALENDAR')).toBeInTheDocument()
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument()
  })

  it('lets an admin through', async () => {
    session = ADMIN
    installFetch()
    renderGuarded('/secret', 'admin')
    expect(await screen.findByText('SECRET CONTENT')).toBeInTheDocument()
  })
})

// ── Login flow ───────────────────────────────────────────────────────────────

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/calendar" element={<div>CALENDAR</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('logs in with valid credentials and lands on the target route', async () => {
    installFetch()
    renderLogin()
    await userEvent.type(screen.getByLabelText('E-Mail'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Passwort'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    expect(await screen.findByText('CALENDAR')).toBeInTheDocument()
  })

  it('shows an error on bad credentials', async () => {
    installFetch()
    renderLogin()
    await userEvent.type(screen.getByLabelText('E-Mail'), 'a@b.c')
    await userEvent.type(screen.getByLabelText('Passwort'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('E-Mail oder Passwort ist falsch.')
  })
})

// ── Session expiry ─────────────────────────────────────────────────────────────

describe('session expiry', () => {
  it('a global 401 event drops the user back to the login screen', async () => {
    session = USER
    installFetch()
    renderGuarded('/secret', 'auth')
    expect(await screen.findByText('SECRET CONTENT')).toBeInTheDocument()
    // Simulate a 401 raised by some later API call.
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument()
  })
})
