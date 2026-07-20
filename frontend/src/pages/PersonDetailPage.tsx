import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { persons, projects as projectsApi, type Person, type PersonAbsence, type VacationContingent, type PersonMembershipDetail, type ProjectMembership } from '../api'
import Modal from '../components/Modal'
import { TYPE_LABELS, TYPE_BADGE as TYPE_COLORS, STATUS_LABELS } from '../lib/absenceColors'
import RegionOverrideSelect from '../components/absence/RegionOverrideSelect'

// ─── Edit person form ─────────────────────────────────────────────────────────

function EditPersonForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Person
  onSave: (d: Omit<Person, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    name: initial.name,
    sage_employee_name: initial.sage_employee_name,
    default_weekly_hours: initial.default_weekly_hours,
    work_week_pattern: initial.work_week_pattern,
    default_billing_rate: initial.default_billing_rate,
    holiday_country: initial.holiday_country ?? null as string | null,
    holiday_state: initial.holiday_state ?? null as string | null,
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="edit-name" className="block text-xs font-medium text-gray-600 mb-1">Name (Anzeige)</label>
        <input id="edit-name" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="edit-sage" className="block text-xs font-medium text-gray-600 mb-1">Sage-Mitarbeitername</label>
        <input id="edit-sage" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.sage_employee_name}
          onChange={(e) => setForm({ ...form, sage_employee_name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="edit-hours" className="block text-xs font-medium text-gray-600 mb-1">Wochenstunden (Standard)</label>
        <input id="edit-hours" required type="number" min={0} max={60} step={0.01}
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.default_weekly_hours}
          onChange={(e) => setForm({ ...form, default_weekly_hours: parseFloat(e.target.value) })} />
      </div>
      <RegionOverrideSelect
        country={form.holiday_country}
        state={form.holiday_state}
        onChange={(c, s) => setForm({ ...form, holiday_country: c, holiday_state: s })}
      />
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
        <button type="submit"
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
      </div>
    </form>
  )
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
            <option value="other">Sonstiges</option>
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

/** "Gebucht" cell: working days + hours an absence books, with the vacation
 *  contingent (after the AU refund) called out when it differs from the raw days. */
function renderBooking(a: PersonAbsence) {
  if (a.booked_working_days == null) return <span className="text-gray-300">–</span>
  const days = a.booked_working_days
  const hours = a.booked_hours ?? 0
  const base = `${days} AT · ${hours} h`
  const isVacation = a.absence_type === 'vacation'
  const refunded = isVacation && a.contingent_days != null && a.contingent_days !== days
  if (refunded) {
    return (
      <span title={`${a.contingent_days} Urlaubstag(e) verbraucht — ${days - (a.contingent_days ?? 0)} durch beglaubigte Krankheit (AU) erstattet. Stunden: ${hours} h.`}>
        {base}
        <span className="ml-1 text-amber-600">(Kontingent {a.contingent_days})</span>
      </span>
    )
  }
  return <span title={isVacation ? `${days} Urlaubstag(e) · ${hours} h (ohne Wochenenden/Feiertage/freie Tage)` : `${days} Arbeitstag(e) · ${hours} h`}>{base}</span>
}

/** Absence overview above the table: per-category booked days/hours and, for
 *  vacation, the contingent split into taken / planned / open. Year selectable. */
function AbsenceSummaryPanel({ personId }: { personId: number }) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const { data } = useQuery({
    queryKey: ['absence-summary', personId, year],
    queryFn: () => persons.absenceSummary(personId, year),
  })
  const v = data?.vacation
  const cats = data?.categories
  const CATS: [keyof NonNullable<typeof cats>, string, string][] = [
    ['vacation', 'Urlaub', 'bg-sky-50 text-sky-700 border-sky-200'],
    ['sick', 'Krank', 'bg-rose-50 text-rose-700 border-rose-200'],
    ['training', 'Fortbildung', 'bg-violet-50 text-violet-700 border-violet-200'],
    ['other', 'Sonstiges', 'bg-gray-50 text-gray-600 border-gray-200'],
  ]
  const total = v && v.contingent > 0 ? v.contingent : 0
  const pct = (n: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0)
  return (
    <div className="mb-4 bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Abwesenheits-Übersicht {year}</h4>
        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => setYear((y) => y - 1)} className="px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Jahr zurück">‹</button>
          <span className="w-12 text-center font-medium text-gray-700">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50" aria-label="Jahr vor">›</button>
        </div>
      </div>

      {v && (
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-600" title="Jahres-Urlaubskontingent">Urlaub: <b className="text-gray-800">{v.contingent}</b> AT</span>
            <span className="text-emerald-700" title="Bestätigte Urlaubstage">genommen {v.taken}</span>
            <span className="text-blue-600" title="Vorgemerkte (geplante) Urlaubstage">geplant {v.planned}</span>
            <span className={v.open <= 0 ? 'text-gray-400' : 'text-amber-600'} title="Verbleibendes Kontingent">offen {v.open}</span>
          </div>
          <div className="mt-1.5 h-2 w-full max-w-md rounded bg-gray-100 overflow-hidden flex" title={`genommen ${v.taken} · geplant ${v.planned} · offen ${v.open} von ${v.contingent}`}>
            <div className="bg-emerald-500 h-full" style={{ width: `${pct(v.taken)}%` }} />
            <div className="bg-blue-400 h-full" style={{ width: `${pct(v.planned)}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {CATS.map(([k, label, cls]) => {
          const c = cats?.[k]
          return (
            <span key={k} className={`px-2 py-1 rounded border text-xs ${cls}`}>
              {label}: <b>{c?.days ?? 0}</b> AT · {c?.hours ?? 0} h
            </span>
          )
        })}
      </div>
    </div>
  )
}

type Tab = 'absences' | 'projects'

// ─── Membership form ──────────────────────────────────────────────────────────

function MembershipForm({
  personId,
  defaultBillingRate,
  onSave,
  onCancel,
}: {
  personId: number
  defaultBillingRate: number | null
  onSave: (d: Omit<ProjectMembership, 'id' | 'project_id'>) => void
  onCancel: () => void
}) {
  const { data: projectList = [] } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list })
  const [form, setForm] = useState({
    person_id: personId,
    from_date: '',
    to_date: '',
    weekly_capacity_hours: 40,
    billing_rate_per_hour: defaultBillingRate ?? 0,
    priority: 0,
    vacation_days_taken: 0,
    billing_position_id: null as number | null,
    project_id: 0,
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form) }} className="space-y-3">
      <div>
        <label htmlFor="ms-project" className="block text-xs font-medium text-gray-600 mb-1">Projekt</label>
        <select id="ms-project" required
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.project_id || ''}
          onChange={(e) => setForm((f) => ({ ...f, project_id: parseInt(e.target.value) }))}>
          <option value="">— Projekt wählen —</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ms-from" className="block text-xs font-medium text-gray-600 mb-1">Von</label>
          <input id="ms-from" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.from_date}
            onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="ms-to" className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
          <input id="ms-to" required type="date"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.to_date}
            onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ms-hours" className="block text-xs font-medium text-gray-600 mb-1">Kapazität (h/Woche)</label>
          <input id="ms-hours" required type="number" min={0} max={60} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.weekly_capacity_hours}
            onChange={(e) => setForm((f) => ({ ...f, weekly_capacity_hours: parseFloat(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="ms-rate" className="block text-xs font-medium text-gray-600 mb-1">Verrechnungssatz (€/h)</label>
          <input id="ms-rate" required type="number" min={0} step={0.01}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.billing_rate_per_hour}
            onChange={(e) => setForm((f) => ({ ...f, billing_rate_per_hour: parseFloat(e.target.value) }))} />
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

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const personId = parseInt(id!)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('absences')
  const [showEdit, setShowEdit] = useState(false)
  const [showAddAbsence, setShowAddAbsence] = useState(false)
  const [editingAbsence, setEditingAbsence] = useState<PersonAbsence | null>(null)
  const [showAddContingent, setShowAddContingent] = useState(false)
  const [editingContingent, setEditingContingent] = useState<VacationContingent | null>(null)
  const [confirmDeleteContingent, setConfirmDeleteContingent] = useState<VacationContingent | null>(null)
  const [showAddMembership, setShowAddMembership] = useState(false)
  const [confirmDeleteMembership, setConfirmDeleteMembership] = useState<PersonMembershipDetail | null>(null)
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
  const { data: memberships = [] } = useQuery({
    queryKey: ['person-memberships', personId],
    queryFn: () => persons.memberships(personId),
  })

  const updatePerson = useMutation({
    mutationFn: (d: Omit<Person, 'id'>) => persons.update(personId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', personId] }); setShowEdit(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const addAbsence = useMutation({
    mutationFn: (d: Omit<PersonAbsence, 'id' | 'person_id'>) => persons.addAbsence(personId, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['absences', personId] }); setShowAddAbsence(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const updateAbsence = useMutation({
    mutationFn: (d: Omit<PersonAbsence, 'id' | 'person_id'>) => persons.updateAbsence(personId, editingAbsence!.id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['absences', personId] }); setEditingAbsence(null); setError(null) },
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
  const updateContingent = useMutation({
    mutationFn: ({ id, d }: { id: number; d: { year: number; total_days: number } }) =>
      persons.updateVacationContingent(personId, id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contingents', personId] }); setEditingContingent(null); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const deleteContingent = useMutation({
    mutationFn: (contingentId: number) => persons.deleteVacationContingent(personId, contingentId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contingents', personId] }); setConfirmDeleteContingent(null) },
  })
  const addMembership = useMutation({
    mutationFn: (d: Omit<ProjectMembership, 'id' | 'project_id'>) =>
      projectsApi.addMembership((d as { project_id: number } & typeof d).project_id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person-memberships', personId] }); setShowAddMembership(false); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const deleteMembership = useMutation({
    mutationFn: ({ projectId, membershipId }: { projectId: number; membershipId: number }) =>
      projectsApi.deleteMembership(projectId, membershipId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person-memberships', personId] }); setConfirmDeleteMembership(null) },
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
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            aria-label="Person bearbeiten"
          >
            <Pencil size={13} /> Bearbeiten
          </button>
        </div>
        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-gray-200 -mb-px">
          {([
            { id: 'absences' as Tab, label: 'Abwesenheiten' },
            { id: 'projects' as Tab, label: 'Projekte' },
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
            <AbsenceSummaryPanel personId={personId} />
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {[
                      { h: 'Typ', t: undefined },
                      { h: 'Von', t: undefined },
                      { h: 'Bis', t: undefined },
                      { h: 'Status', t: undefined },
                      { h: 'Gebucht', t: 'Gebuchte Arbeitstage und Stunden dieses Zeitraums — ohne Wochenenden, Feiertage und im Arbeitsmodell freie Tage. Bei Urlaub: Kontingentverbrauch nach Erstattung bei beglaubigter Krankheit (AU).' },
                      { h: 'Notiz', t: undefined },
                      { h: '', t: undefined },
                    ].map(({ h, t }) => (
                      <th key={h || 'actions'} scope="col" title={t}
                        className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase ${t ? 'cursor-help' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedAbsences.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Keine Abwesenheiten eingetragen.</td></tr>
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
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{renderBooking(a)}</td>
                      <td className="px-4 py-3 text-sm text-gray-400 max-w-[12rem] truncate">{a.note}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <button
                            aria-label="Abwesenheit bearbeiten"
                            onClick={() => { setEditingAbsence(a); setError(null) }}
                            className="text-gray-400 hover:text-blue-500"
                          ><Pencil size={14} /></button>
                          <button
                            aria-label="Abwesenheit löschen"
                            onClick={() => deleteAbsence.mutate(a.id)}
                            className="text-gray-400 hover:text-red-500"
                          ><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Projects (memberships) ── */}
        {tab === 'projects' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium text-gray-700">Projektzuweisungen</h3>
              <button onClick={() => setShowAddMembership(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Plus size={14} /> Projekt zuweisen
              </button>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {['Projekt', 'Von', 'Bis', 'h/Woche', '€/h', ''].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {memberships.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Keine Projektzuweisungen vorhanden.</td></tr>
                  )}
                  {memberships.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 text-sm">
                        <Link to={`/projects/${m.project_id}`} className="font-medium text-blue-600 hover:underline">
                          {m.project_number}
                        </Link>
                        <span className="ml-2 text-gray-500">{m.project_name}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{m.from_date}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{m.to_date}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{m.weekly_capacity_hours}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{m.billing_rate_per_hour}</td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          aria-label="Zuweisung entfernen"
                          onClick={() => setConfirmDeleteMembership(m)}
                          className="text-gray-400 hover:text-red-500">
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
      </div>

      {/* Person settings modal (person fields + vacation contingents) */}
      {showEdit && (
        <Modal title="Personeneinstellungen" onClose={() => { setShowEdit(false); setEditingContingent(null); setShowAddContingent(false); setError(null) }}>
          <EditPersonForm
            initial={person}
            onSave={(d) => updatePerson.mutate(d)}
            onCancel={() => { setShowEdit(false); setError(null) }}
          />

          {/* Vacation contingents — moved here from the removed tab */}
          <div className="mt-5 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">Urlaubskontingente</h4>
              {!showAddContingent && !editingContingent && (
                <button onClick={() => setShowAddContingent(true)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <Plus size={12} /> Kontingent
                </button>
              )}
            </div>

            {(showAddContingent || editingContingent) ? (
              <ContingentForm
                initial={editingContingent ?? undefined}
                onSave={(d) => editingContingent
                  ? updateContingent.mutate({ id: editingContingent.id, d })
                  : addContingent.mutate(d)}
                onCancel={() => { setShowAddContingent(false); setEditingContingent(null); setError(null) }}
              />
            ) : (
              <div className="space-y-1">
                {sortedContingents.length === 0 && (
                  <p className="text-xs text-gray-400">Noch keine Kontingente eingetragen.</p>
                )}
                {sortedContingents.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm border border-gray-100 rounded px-2 py-1">
                    <span className="text-gray-700"><span className="font-medium">{c.year}</span> · {c.total_days} Tage</span>
                    <span className="flex items-center gap-2">
                      <button aria-label={`Kontingent ${c.year} bearbeiten`} onClick={() => { setEditingContingent(c); setError(null) }} className="text-gray-400 hover:text-blue-500"><Pencil size={13} /></button>
                      <button aria-label={`Kontingent ${c.year} löschen`} onClick={() => setConfirmDeleteContingent(c)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Add absence modal */}
      {showAddAbsence && (
        <Modal title="Neue Abwesenheit" onClose={() => { setShowAddAbsence(false); setError(null) }}>
          <AbsenceForm
            onSave={(d) => addAbsence.mutate(d)}
            onCancel={() => { setShowAddAbsence(false); setError(null) }}
          />
        </Modal>
      )}

      {/* Edit absence modal */}
      {editingAbsence && (
        <Modal title="Abwesenheit bearbeiten" onClose={() => { setEditingAbsence(null); setError(null) }}>
          <AbsenceForm
            initial={editingAbsence}
            onSave={(d) => updateAbsence.mutate(d)}
            onCancel={() => { setEditingAbsence(null); setError(null) }}
          />
        </Modal>
      )}

      {/* Add membership modal */}
      {showAddMembership && (
        <Modal title="Projekt zuweisen" onClose={() => { setShowAddMembership(false); setError(null) }}>
          <MembershipForm
            personId={personId}
            defaultBillingRate={person.default_billing_rate ?? null}
            onSave={(d) => addMembership.mutate(d)}
            onCancel={() => { setShowAddMembership(false); setError(null) }}
          />
        </Modal>
      )}

      {/* Confirm delete contingent */}
      {confirmDeleteContingent && (
        <Modal title="Kontingent löschen" onClose={() => setConfirmDeleteContingent(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Urlaubskontingent <strong>{confirmDeleteContingent.year}</strong> ({confirmDeleteContingent.total_days} Tage) löschen?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeleteContingent(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button
              onClick={() => deleteContingent.mutate(confirmDeleteContingent.id)}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">
              Löschen
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm delete membership */}
      {confirmDeleteMembership && (
        <Modal title="Zuweisung entfernen" onClose={() => setConfirmDeleteMembership(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Person aus Projekt <strong>{confirmDeleteMembership.project_number}</strong> entfernen?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDeleteMembership(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button
              onClick={() => deleteMembership.mutate({ projectId: confirmDeleteMembership.project_id, membershipId: confirmDeleteMembership.id })}
              className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">
              Entfernen
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
