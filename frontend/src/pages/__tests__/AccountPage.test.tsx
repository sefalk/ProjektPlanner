import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext'
import AccountPage from '../AccountPage'

const USER = { id: 1, email: 'a@b.c', is_active: true, is_superuser: false, is_verified: true }

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body } as Response
}

/** Fake backend: /users/me (GET bootstrap, PATCH update) + /auth/login for the
 *  current-password re-verification. Current password is 'secret'. */
function installFetch() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/users/me') && init?.method === 'PATCH') return jsonRes(200, { ...USER })
    if (url.endsWith('/users/me')) return jsonRes(200, USER)
    if (url.endsWith('/auth/login')) {
      const body = String(init?.body ?? '')
      return body.includes('password=secret')
        ? ({ ok: true, status: 204, text: async () => '', json: async () => undefined } as Response)
        : jsonRes(400, { detail: 'LOGIN_BAD_CREDENTIALS' })
    }
    return jsonRes(404, {})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderAccount() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => { installFetch() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('AccountPage password change', () => {
  it('verifies the current password, then PATCHes the new one', async () => {
    const fn = installFetch()
    const { container } = renderAccount()
    expect(await screen.findByText('Angemeldet als')).toBeInTheDocument()

    await userEvent.type(container.querySelector('#acc-cur-pw')!, 'secret')
    await userEvent.type(container.querySelector('#acc-new-pw')!, 'Pw123456789!')
    await userEvent.type(container.querySelector('#acc-new-pw2')!, 'Pw123456789!')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort speichern' }))

    expect(await screen.findByText('Passwort geändert.')).toBeInTheDocument()
    expect(fn.mock.calls.some(([u, i]) => String(u).endsWith('/users/me') && (i as RequestInit)?.method === 'PATCH')).toBe(true)
  })

  it('rejects a wrong current password and does not PATCH', async () => {
    const fn = installFetch()
    const { container } = renderAccount()
    expect(await screen.findByText('Angemeldet als')).toBeInTheDocument()

    await userEvent.type(container.querySelector('#acc-cur-pw')!, 'wrong-one')
    await userEvent.type(container.querySelector('#acc-new-pw')!, 'Pw123456789!')
    await userEvent.type(container.querySelector('#acc-new-pw2')!, 'Pw123456789!')
    await userEvent.click(screen.getByRole('button', { name: 'Passwort speichern' }))

    expect(await screen.findByText('Aktuelles Passwort ist falsch.')).toBeInTheDocument()
    expect(fn.mock.calls.some(([u, i]) => String(u).endsWith('/users/me') && (i as RequestInit)?.method === 'PATCH')).toBe(false)
  })

  it('disables submit until the new password satisfies the policy', async () => {
    const { container } = renderAccount()
    expect(await screen.findByText('Angemeldet als')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Passwort speichern' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.type(container.querySelector('#acc-new-pw')!, 'Pw123456789!')
    expect(submit.disabled).toBe(false)
  })
})
