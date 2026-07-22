/** Invite-token management (doc 25, WP4) — admin only.
 *
 * The only way new users get in: an admin mints a one-time token here and shares
 * it (out of band) with the invitee, who redeems it on the registration screen.
 * The full token is shown only in this list; there is no e-mail delivery.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ticket, Plus, Copy, Check, Loader2 } from 'lucide-react'
import { auth, type Invite } from '../api'
import PageHeader from '../components/PageHeader'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE')
}

function statusOf(inv: Invite): { label: string; cls: string } {
  if (inv.used_by != null) return { label: 'Verwendet', cls: 'bg-gray-100 text-gray-500' }
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { label: 'Abgelaufen', cls: 'bg-amber-50 text-amber-700' }
  return { label: 'Offen', cls: 'bg-green-50 text-green-700' }
}

function TokenCell({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — token is visible for manual copy */
    }
  }
  return (
    <div className="flex items-center gap-2">
      <code className="max-w-[22rem] truncate rounded bg-gray-50 px-2 py-0.5 text-xs text-gray-700">{token}</code>
      <button onClick={copy} title="Token kopieren"
        className="text-gray-400 hover:text-gray-700" aria-label="Token kopieren">
        {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
      </button>
    </div>
  )
}

export default function InvitesPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['invites'], queryFn: auth.invites.list })

  const create = useMutation({
    mutationFn: () => auth.invites.create(14),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })

  return (
    <div>
      <PageHeader
        title="Einladungen"
        subtitle="Einmal-Token zur Registrierung neuer Nutzer erzeugen und verwalten"
        actions={
          <button
            onClick={() => create.mutate()} disabled={create.isPending}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Token erzeugen
          </button>
        }
      />

      <div className="p-6 max-w-4xl">
        <p className="mb-4 flex items-start gap-2 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Ticket size={14} className="mt-0.5 flex-shrink-0" />
          Ein Token gilt für genau eine Registrierung, läuft nach 14 Tagen ab und wird beim Anlegen des Kontos verbraucht. Gib den Token sicher an die einzuladende Person weiter.
        </p>

        {isLoading ? (
          <p className="text-sm text-gray-400">Lade…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-gray-500">Noch keine Einladungen. Erzeuge oben ein Token.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-2">Token</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Erstellt</th>
                  <th className="px-4 py-2">Läuft ab</th>
                  <th className="px-4 py-2">Verwendet</th>
                </tr>
              </thead>
              <tbody>
                {data.map((inv) => {
                  const s = statusOf(inv)
                  return (
                    <tr key={inv.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2"><TokenCell token={inv.token} /></td>
                      <td className="px-4 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{formatDate(inv.created_at)}</td>
                      <td className="px-4 py-2 text-gray-500">{formatDate(inv.expires_at)}</td>
                      <td className="px-4 py-2 text-gray-500">{formatDate(inv.used_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
