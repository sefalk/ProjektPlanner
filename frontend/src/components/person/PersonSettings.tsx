import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { persons, projects as projectsApi, type Person, type ProjectMembership } from '../../api'
import Modal from '../Modal'
import PersonForm from './PersonForm'
import { ContingentForm, MembershipForm, MembershipEditForm } from './forms'

// The ONE person-editing surface, shared by the persons table and the person detail
// view so both expose exactly the same thing: person fields + Urlaubskontingente +
// a compact, editable list of Projektzuweisungen. Self-contained (owns its queries,
// mutations and cache invalidation) so it drops into either page unchanged.

export default function PersonSettings({ person, onClose }: { person: Person; onClose: () => void }) {
  const personId = person.id
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const [showAddContingent, setShowAddContingent] = useState(false)
  const [editingContingentId, setEditingContingentId] = useState<number | null>(null)
  const [confirmDelContingent, setConfirmDelContingent] = useState<number | null>(null)

  const [showAddMembership, setShowAddMembership] = useState(false)
  const [editingMembershipId, setEditingMembershipId] = useState<number | null>(null)
  const [confirmDelMembership, setConfirmDelMembership] = useState<number | null>(null)

  const { data: contingents = [] } = useQuery({
    queryKey: ['contingents', personId],
    queryFn: () => persons.vacationContingents(personId),
  })
  const { data: memberships = [] } = useQuery({
    queryKey: ['person-memberships', personId],
    queryFn: () => persons.memberships(personId),
  })

  // A change here (esp. the holiday-region override, capacities, contingents) feeds the
  // persons table, the year calendar and the absence summaries — invalidate them all so
  // no view shows stale data until a reload, regardless of which page opened this.
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['person', personId] })
    qc.invalidateQueries({ queryKey: ['persons-with-projects'] })
    qc.invalidateQueries({ queryKey: ['persons'] })
    qc.invalidateQueries({ queryKey: ['contingents', personId] })
    qc.invalidateQueries({ queryKey: ['person-memberships', personId] })
    qc.invalidateQueries({ queryKey: ['absence-summary'] })
    qc.invalidateQueries({ queryKey: ['absence-summary-batch'] })
    qc.invalidateQueries({ queryKey: ['calendar-year'] })
  }

  const updatePerson = useMutation({
    mutationFn: (d: Omit<Person, 'id'>) => persons.update(personId, d),
    onSuccess: () => { invalidateAll(); setError(null); onClose() },
    onError: (e: Error) => setError(e.message),
  })
  const addContingent = useMutation({
    mutationFn: (d: { year: number; total_days: number }) => persons.addVacationContingent(personId, d),
    onSuccess: () => { invalidateAll(); setShowAddContingent(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const updateContingent = useMutation({
    mutationFn: ({ id, d }: { id: number; d: { year: number; total_days: number } }) =>
      persons.updateVacationContingent(personId, id, d),
    onSuccess: () => { invalidateAll(); setEditingContingentId(null); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const deleteContingent = useMutation({
    mutationFn: (id: number) => persons.deleteVacationContingent(personId, id),
    onSuccess: () => { invalidateAll(); setConfirmDelContingent(null) },
  })
  const addMembership = useMutation({
    mutationFn: (d: Omit<ProjectMembership, 'id' | 'project_id'>) =>
      projectsApi.addMembership((d as { project_id: number } & typeof d).project_id, d),
    onSuccess: () => { invalidateAll(); setShowAddMembership(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const updateMembership = useMutation({
    mutationFn: ({ projectId, membershipId, d }: {
      projectId: number; membershipId: number
      d: Parameters<typeof projectsApi.updateMembership>[2]
    }) => projectsApi.updateMembership(projectId, membershipId, d),
    onSuccess: () => { invalidateAll(); setEditingMembershipId(null); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const deleteMembership = useMutation({
    mutationFn: ({ projectId, membershipId }: { projectId: number; membershipId: number }) =>
      projectsApi.deleteMembership(projectId, membershipId),
    onSuccess: () => { invalidateAll(); setConfirmDelMembership(null) },
  })

  const sortedContingents = [...contingents].sort((a, b) => b.year - a.year)

  return (
    <Modal title="Personeneinstellungen" onClose={onClose}>
      {error && (
        <div className="mb-3 p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200">{error}</div>
      )}

      <PersonForm
        initial={person}
        onSave={(d) => updatePerson.mutate(d)}
        onCancel={onClose}
      />

      {/* ── Urlaubskontingente ── */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700">Urlaubskontingente</h4>
          {!showAddContingent && editingContingentId === null && (
            <button onClick={() => setShowAddContingent(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <Plus size={12} /> Kontingent
            </button>
          )}
        </div>

        {showAddContingent ? (
          <ContingentForm
            onSave={(d) => addContingent.mutate(d)}
            onCancel={() => { setShowAddContingent(false); setError(null) }}
          />
        ) : (
          <div className="space-y-1">
            {sortedContingents.length === 0 && (
              <p className="text-xs text-gray-400">Noch keine Kontingente eingetragen.</p>
            )}
            {sortedContingents.map((c) => editingContingentId === c.id ? (
              <ContingentForm key={c.id} initial={c}
                onSave={(d) => updateContingent.mutate({ id: c.id, d })}
                onCancel={() => { setEditingContingentId(null); setError(null) }}
              />
            ) : (
              <div key={c.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-2 py-1">
                <span className="text-gray-700"><span className="font-medium">{c.year}</span> · {c.total_days} Tage</span>
                {confirmDelContingent === c.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Löschen?</span>
                    <button onClick={() => deleteContingent.mutate(c.id)} className="text-red-600 hover:underline">Ja</button>
                    <button onClick={() => setConfirmDelContingent(null)} className="text-gray-500 hover:underline">Nein</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <button title="Kontingent bearbeiten" aria-label={`Kontingent ${c.year} bearbeiten`} onClick={() => { setEditingContingentId(c.id); setError(null) }} className="text-gray-400 hover:text-blue-500"><Pencil size={13} /></button>
                    <button title="Kontingent löschen" aria-label={`Kontingent ${c.year} löschen`} onClick={() => setConfirmDelContingent(c.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Projektzuweisungen (compact, editable) ── */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700">Projektzuweisungen</h4>
          {!showAddMembership && editingMembershipId === null && (
            <button onClick={() => setShowAddMembership(true)}
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <Plus size={12} /> Projekt
            </button>
          )}
        </div>

        {showAddMembership ? (
          <MembershipForm
            personId={personId}
            defaultBillingRate={person.default_billing_rate ?? null}
            onSave={(d) => addMembership.mutate(d)}
            onCancel={() => { setShowAddMembership(false); setError(null) }}
          />
        ) : (
          <div className="space-y-1">
            {memberships.length === 0 && (
              <p className="text-xs text-gray-400">Keine Projektzuweisungen vorhanden.</p>
            )}
            {memberships.map((m) => editingMembershipId === m.id ? (
              <MembershipEditForm key={m.id} initial={m}
                onSave={(d) => updateMembership.mutate({ projectId: m.project_id, membershipId: m.id, d })}
                onCancel={() => { setEditingMembershipId(null); setError(null) }}
              />
            ) : (
              <div key={m.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-2 py-1">
                <span className="text-gray-700 truncate">
                  <span className="font-medium">{m.project_number}</span>
                  <span className="text-gray-500"> · {m.from_date}–{m.to_date} · {m.weekly_capacity_hours} h · {m.billing_rate_per_hour} €</span>
                </span>
                {confirmDelMembership === m.id ? (
                  <span className="flex items-center gap-2 text-xs shrink-0">
                    <span className="text-gray-500">Entfernen?</span>
                    <button onClick={() => deleteMembership.mutate({ projectId: m.project_id, membershipId: m.id })} className="text-red-600 hover:underline">Ja</button>
                    <button onClick={() => setConfirmDelMembership(null)} className="text-gray-500 hover:underline">Nein</button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2 shrink-0">
                    <button title="Zuweisung bearbeiten (Zeitraum, Kapazität, Satz)" aria-label="Zuweisung bearbeiten" onClick={() => { setEditingMembershipId(m.id); setError(null) }} className="text-gray-400 hover:text-blue-500"><Pencil size={13} /></button>
                    <button title="Zuweisung entfernen" aria-label="Zuweisung entfernen" onClick={() => setConfirmDelMembership(m.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
