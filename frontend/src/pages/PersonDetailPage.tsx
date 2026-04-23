import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { persons, type PersonAbsence, type VacationContingent } from '../api'
import Modal from '../components/Modal'

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<PersonAbsence['absence_type'], string> = {
  vacation: 'Urlaub',
  sick: 'Krank',
  training: 'Fortbildung',
}

const TYPE_COLORS: Record<PersonAbsence['absence_type'], string> = {
  vacation: 'bg-blue-100 text-blue-700',
  sick: 'bg-yellow-100 text-yellow-700',
  training: 'bg-emerald-100 text-emerald-700',
}

const STATUS_LABELS: Record<PersonAbsence['status'], string> = {
  planned: 'Geplant',
  confirmed: 'Bestätigt',
  ongoing: 'Laufend',
}

// ─── Absence form ─────────────────────────────────────────────────────────────

type AbsenceFormData = Omit<PersonAbsence, 'id' | 'person_id'>

function AbsenceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<AbsenceFormData>
  onSave: (d: AbsenceFormData) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<AbsenceFormData>({
    absence_type: initial?.absence_type ?? 'vacation',
    status: initial?.status ?? 'planned',
    start_date: initial?.start_date ?? '',
    end_date: initial?.end_date ?? '',
    note: initial?.note ?? '',
  })

  const isSick = form.absence_type === 'sick'
  const isOngoing = form.status === 'ongoing'

  // Adjust status when type changes
  function setType(t: PersonAbsence['absence_type']) {
    const defaultStatus: PersonAbsence['status'] = t === 'sick' ? 'ongoing' : 'planned'
    setForm((f) => ({ ...f, absence_type: t, status: defaultStatus, end_date: t === 'sick' ? '' : f.end_date }))
  }

  function setStatus(s: PersonAbsence['status']) {
    setForm((f) => ({ ...f, status: s }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave({ ...form, end_date: form.end_date || null })
  }

  const allowedStatuses: PersonAbsence['status'][] = isSick
    ? ['ongoing', 'confirmed']
    : ['planned', 'confirmed']

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="abs-type" className="block text-xs font-medium text-gray-600 mb-1">Typ</label>
          <select id="abs-type" required
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.absence_type}
            onChange={(e) => setType(e.target.value as PersonAbsence['absence_type'])}>
            <option value="vacation">Urlaub</option>
            <option value="training">Fortbildung</option>
            <option value="sick">Krank</option>
          </select>
        </div>
        <div>
          <label htmlFor="abs-status" className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select id="abs-status" required
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.status}
            onChange={(e) => setStatus(e.target.value as PersonAbsence['status'])}>
            {allowedStatuses.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="abs-start" className="block text-xs font-medium text-gray-600 mb-1">Von</label>
          <input id="abs-start" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.start_date}
            onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="abs-end" className="block text-xs font-medium text-gray-600 mb-1">
            Bis {isSick && isOngoing && <span className="text-gray-400">(optional)</span>}
          </label>
          <input id="abs-end"
            required={!isOngoing}
            type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.end_date ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value || null }))} />
        </div>
      </div>
      <div>
        <label htmlFor="abs-note" className="block text-xs font-medium text-gray-600 mb-1">Notiz</label>
        <input id="abs-note" type="text"
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
      </div>
    </form>
  )
}

// ─── Vacation contingent form ─────────────────────────────────────────────────

function ContingentForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<VacationContingent>
  onSave: (d: { year: number; total_days: number }) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    year: initial?.year ?? new Date().getFullYear(),
    total_days: initial?.total_days ?? 30,
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cont-year" className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <input id="cont-year" required type="number" min={2000} max={2100}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.year}
            onChange={(e) => setForm((f) => ({ ...f, year: parseInt(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="cont-days" className="block text-xs font-medium text-gray-600 mb-1">Urlaubstage</label>
          <input id="cont-days" required type="number" min={0} max={365} step={0.5}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.total_days}
            onChange={(e) => setForm((f) => ({ ...f, total_days: parseFloat(e.target.value) }))} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
      </div>
    </form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'absences' | 'contingents'

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const personId = parseInt(id!)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('absences')
  const [showAddAbsence, setShowAddAbsence] = useState(false)
  const [showAddContingent, setShowAddContingent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: person } = useQuery({
    queryKey: ['person', personId],
    queryFn: () => persons.get(personId),
  })
  const { data: absences = [] } = useQuery({
    queryKey: ['absences', personId],
    queryFn: () => persons.absences(personId),
  })
  const { data: contingents = [] } = useQuery({
    queryKey: ['contingents', personId],
    queryFn: () => persons.vacationContingents(personId),
  })

  const addAbsence = useMutation({
    mutationFn: (d: Omit<PersonAbsence, 'id' | 'person_id'>) => persons.addAbsence(personId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['absences', personId] }); setShowAddAbsence(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const deleteAbsence = useMutation({
    mutationFn: (absenceId: number) => persons.deleteAbsence(personId, absenceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['absences', personId] }),
  })
  const addContingent = useMutation({
    mutationFn: (d: { year: number; total_days: number }) => persons.addVacationContingent(personId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contingents', personId] }); setShowAddContingent(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })

  if (!person) return <div className="p-6 text-sm text-gray-400">Lade…</div>

  const sortedAbsences = [...absences].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const sortedContingents = [...contingents].sort((a, b) => b.year - a.year)

  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <button onClick={() => navigate('/persons')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ChevronLeft size={14} /> Personen
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{person.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {person.sage_employee_name} · {person.default_weekly_hours} h/Woche
            </p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-gray-200 -mb-px">
          {([
            { id: 'absences' as Tab, label: 'Abwesenheiten' },
            { id: 'contingents' as Tab, label: 'Urlaubskontingente' },
          ]).map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setError(null) }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 text-red-700 text-sm rounded border border-red-200">{error}</div>
      )}

      <div className="p-6">

        {/* ── Absences ── */}
        {tab === 'absences' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium text-gray-700">Abwesenheiten</h3>
              <button onClick={() => setShowAddAbsence(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Plus size={14} /> Neue Abwesenheit
              </button>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Typ', 'Von', 'Bis', 'Status', 'Notiz', ''].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedAbsences.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Keine Abwesenheiten eingetragen.</td></tr>
                  )}
                  {sortedAbsences.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[a.absence_type]}`}>
                          {TYPE_LABELS[a.absence_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{a.start_date}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{a.end_date ?? <span className="text-gray-400 italic">laufend</span>}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{STATUS_LABELS[a.status]}</td>
                      <td className="px-4 py-3 text-sm text-gray-400 max-w-[12rem] truncate">{a.note}</td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          aria-label="Abwesenheit löschen"
                          onClick={() => deleteAbsence.mutate(a.id)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Vacation contingents ── */}
        {tab === 'contingents' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium text-gray-700">Urlaubskontingente</h3>
              <button onClick={() => setShowAddContingent(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Plus size={14} /> Neues Kontingent
              </button>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Jahr', 'Urlaubstage'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedContingents.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Kontingente eingetragen.</td></tr>
                  )}
                  {sortedContingents.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-700">{c.year}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{c.total_days} Tage</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add absence modal */}
      {showAddAbsence && (
        <Modal title="Neue Abwesenheit" onClose={() => { setShowAddAbsence(false); setError(null) }}>
          <AbsenceForm
            onSave={(d) => addAbsence.mutate(d)}
            onCancel={() => { setShowAddAbsence(false); setError(null) }}
          />
        </Modal>
      )}

      {/* Add contingent modal */}
      {showAddContingent && (
        <Modal title="Urlaubskontingent" onClose={() => { setShowAddContingent(false); setError(null) }}>
          <ContingentForm
            onSave={(d) => addContingent.mutate(d)}
            onCancel={() => { setShowAddContingent(false); setError(null) }}
          />
        </Modal>
      )}
    </div>
  )
}
