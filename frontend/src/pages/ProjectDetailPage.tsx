import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw, Lock, Unlock, TrendingUp, FileText, Plus, Trash2, ChevronDown, ChevronRight, Pencil, Flag, RotateCcw, Mail, Copy } from 'lucide-react'
import {
  projects, persons, programs, invoices as invoiceApi, bookings as bookingsApi,
  type Project, type Program, type ProjectMembership, type MonthlyInvoice, type MilestoneDetail, type TimeBooking, type ExclusionReason,
} from '../api'
import Modal from '../components/Modal'
import Table from '../components/Table'

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
]

// ─── Bookings tab ─────────────────────────────────────────────────────────────

const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  duplicate: 'Duplikat',
  incorrect: 'Fehlerhaft',
  cancelled: 'Storniert',
  test: 'Test',
}

function FlagCell({ booking, queryKey }: { booking: TimeBooking; queryKey: unknown[] }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ExclusionReason>('duplicate')
  const [note, setNote] = useState('')

  const { mutate: flag, isPending } = useMutation({
    mutationFn: (data: Parameters<typeof bookingsApi.flag>[1]) => bookingsApi.flag(booking.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setOpen(false) },
  })

  if (booking.is_excluded) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs font-medium" title={booking.exclusion_note ?? undefined}>
          <Flag size={10} />
          {EXCLUSION_LABELS[booking.exclusion_reason as ExclusionReason] ?? booking.exclusion_reason}
        </span>
        <button
          title="Kennzeichnung aufheben"
          onClick={() => flag({ is_excluded: false })}
          disabled={isPending}
          className="text-gray-400 hover:text-gray-700 p-0.5 rounded"
        >
          <RotateCcw size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Als fehlerhaft kennzeichnen"
        className="text-gray-300 hover:text-red-500 p-0.5 rounded transition-colors"
      >
        <Flag size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-52 text-xs">
          <p className="font-medium text-gray-700 mb-2">Buchung ausschließen</p>
          <select
            className="w-full border border-gray-300 rounded px-2 py-1 mb-2"
            value={reason}
            onChange={e => setReason(e.target.value as ExclusionReason)}
          >
            {(Object.entries(EXCLUSION_LABELS) as [ExclusionReason, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Kommentar (optional)"
            className="w-full border border-gray-300 rounded px-2 py-1 mb-2"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button onClick={() => setOpen(false)} className="flex-1 px-2 py-1 border border-gray-200 rounded hover:bg-gray-50">
              Abbruch
            </button>
            <button
              disabled={isPending}
              onClick={() => flag({ is_excluded: true, exclusion_reason: reason, exclusion_note: note || null })}
              className="flex-1 px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              Ausschließen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type SortKey = 'booking_date' | 'person_name' | 'net_hours' | 'sage_project_level'

function BookingsTab({ projectId, memberships }: { projectId: number; memberships: ProjectMembership[] }) {
  const [filterPerson, setFilterPerson] = useState(0)
  const [filterYear, setFilterYear] = useState(new Date().getFullYear())
  const [filterMonth, setFilterMonth] = useState(0)   // 0 = all months
  const [filterWeek, setFilterWeek] = useState(0)     // 0 = no week filter
  const [sortKey, setSortKey] = useState<SortKey>('booking_date')
  const [sortAsc, setSortAsc] = useState(false)
  const { data: allPersons = [] } = useQuery({ queryKey: ['persons'], queryFn: persons.list })

  const filters = {
    ...(filterPerson > 0 && { person_id: filterPerson }),
    year: filterYear,
    ...(filterMonth > 0 && filterWeek === 0 && { month: filterMonth }),
    ...(filterWeek > 0 && { week: filterWeek }),
  }

  const bookingsQueryKey = ['project-bookings', projectId, filters]
  const { data: bookings = [], isLoading } = useQuery<TimeBooking[]>({
    queryKey: bookingsQueryKey,
    queryFn: () => projects.bookings(projectId, filters),
  })

  const memberPersonIds = new Set(memberships.map(m => m.person_id))
  const personOptions = allPersons.filter(p => memberPersonIds.has(p.id))

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  const sorted = [...bookings].sort((a, b) => {
    let v = 0
    if (sortKey === 'booking_date') v = a.booking_date.localeCompare(b.booking_date)
    else if (sortKey === 'person_name') v = a.person_name.localeCompare(b.person_name)
    else if (sortKey === 'net_hours') v = a.net_hours - b.net_hours
    else if (sortKey === 'sage_project_level') v = a.sage_project_level.localeCompare(b.sage_project_level)
    return sortAsc ? v : -v
  })

  const activeBookings = bookings.filter(b => !b.is_excluded)
  const totalHours = activeBookings.reduce((s, b) => s + b.net_hours, 0)

  const SortTh = ({ k, label, title }: { k: SortKey; label: string; title?: string }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-gray-800 select-none"
      title={title}
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  )

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Person</label>
          <select
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterPerson}
            onChange={e => setFilterPerson(parseInt(e.target.value))}
          >
            <option value={0}>Alle Personen</option>
            {personOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Jahr</label>
          <select
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterYear}
            onChange={e => { setFilterYear(parseInt(e.target.value)); setFilterWeek(0) }}
          >
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Monat</label>
          <select
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterMonth}
            onChange={e => { setFilterMonth(parseInt(e.target.value)); setFilterWeek(0) }}
            disabled={filterWeek > 0}
          >
            <option value={0}>Alle Monate</option>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">KW</label>
          <select
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterWeek}
            onChange={e => { setFilterWeek(parseInt(e.target.value)); setFilterMonth(0) }}
          >
            <option value={0}>Alle Wochen</option>
            {Array.from({ length: 53 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>KW {w}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          {isLoading ? 'Lade…' : <><span className="font-medium text-gray-800">{activeBookings.length}</span> Buchungen · <span className="font-medium text-gray-800">{totalHours.toFixed(2)} h</span>{bookings.length > activeBookings.length && <span className="text-red-400 ml-1">({bookings.length - activeBookings.length} ausgeschlossen)</span>}</>}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <SortTh k="booking_date" label="Datum" />
              <SortTh k="person_name" label="Person" />
              <SortTh k="sage_project_level" label="Projektebene" title="Sage-Projektebene 1" />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dauer (roh)</th>
              <SortTh k="net_hours" label="Std." />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bemerkung</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">Keine Buchungen für diesen Filter.</td></tr>
            )}
            {sorted.map(b => (
              <tr key={b.id} className={b.is_excluded ? 'bg-red-50' : 'hover:bg-gray-50'}>
                <td className={`px-4 py-2.5 text-sm font-mono ${b.is_excluded ? 'text-red-400 line-through' : 'text-gray-700'}`}>{b.booking_date}</td>
                <td className={`px-4 py-2.5 text-sm ${b.is_excluded ? 'text-red-400 line-through' : 'text-gray-700'}`}>{b.person_name}</td>
                <td className={`px-4 py-2.5 text-sm ${b.is_excluded ? 'text-red-300 line-through' : 'text-gray-600'}`}>{b.sage_project_level}</td>
                <td className={`px-4 py-2.5 text-sm font-mono ${b.is_excluded ? 'text-red-300 line-through' : 'text-gray-500'}`}>{b.duration_raw || '–'}</td>
                <td className={`px-4 py-2.5 text-sm font-mono text-right ${b.is_excluded ? 'text-red-400 line-through' : 'text-gray-800'}`}>{b.net_hours.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[8rem] truncate">{b.note || ''}</td>
                <td className="px-2 py-2.5 text-right"><FlagCell booking={b} queryKey={bookingsQueryKey} /></td>
              </tr>
            ))}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="bg-gray-50 font-medium text-gray-700">
              <tr>
                <td colSpan={4} className="px-4 py-2.5 text-sm">Gesamt (aktiv)</td>
                <td className="px-4 py-2.5 text-sm font-mono text-right">{totalHours.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function BillingPositionForm({
  onSave,
  isPending,
}: {
  onSave: (d: { position_number: string; description: string; budget_euros: number }) => void
  isPending: boolean
}) {
  const [form, setForm] = useState({ position_number: '', description: '', budget_euros: '' })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave({
      position_number: form.position_number.trim(),
      description: form.description.trim(),
      budget_euros: form.budget_euros ? parseFloat(form.budget_euros) : 0,
    })
    setForm({ position_number: '', description: '', budget_euros: '' })
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Positionsnr.</label>
        <input
          required
          placeholder="z.B. AP1"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.position_number}
          onChange={(e) => setForm({ ...form, position_number: e.target.value })}
        />
      </div>
      <div className="flex-1 min-w-[10rem]">
        <label className="block text-xs text-gray-500 mb-1">Bezeichnung</label>
        <input
          required
          placeholder="z.B. Softwareentwicklung"
          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Budget (€) <span className="text-gray-400">optional</span></label>
        <input
          type="number"
          min={0}
          step={0.01}
          placeholder="0"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.budget_euros}
          onChange={(e) => setForm({ ...form, budget_euros: e.target.value })}
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
      >
        <Plus size={13} /> Hinzufügen
      </button>
    </form>
  )
}

const STATUS_COLORS: Record<MonthlyInvoice['status'], string> = {
  planned: 'bg-yellow-100 text-yellow-700',
  invoiced: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
}

const STATUS_LABELS: Record<MonthlyInvoice['status'], string> = {
  planned: 'Geplant',
  invoiced: 'Abgerechnet',
  paid: 'Bezahlt',
}

type Tab = 'milestones' | 'rebalancing' | 'invoices' | 'members' | 'bookings' | 'settings'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = parseInt(id!)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('milestones')
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [editMember, setEditMember] = useState<ProjectMembership | null>(null)
  const [editMemberForm, setEditMemberForm] = useState({ from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90 })
  const [confirmReopenId, setConfirmReopenId] = useState<number | null>(null)
  const [confirmReopenMilestone, setConfirmReopenMilestone] = useState<{ year: number; month: number } | null>(null)
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set())
  const [editBudget, setEditBudget] = useState<{ milestoneId: number; personId: number; personName: string; currentHours: number } | null>(null)
  const [editHours, setEditHours] = useState(0)
  const [closeForm, setCloseForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, billing_position_id: 0 })
  const [addMemberForm, setAddMemberForm] = useState({ person_id: 0, from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90 })
  const [error, setError] = useState<string | null>(null)
  const [memberWarnings, setMemberWarnings] = useState<string[]>([])
  const [closeWarnings, setCloseWarnings] = useState<string[]>([])
  const [pendingCloseForm, setPendingCloseForm] = useState<typeof closeForm | null>(null)
  const [showReinitConfirm, setShowReinitConfirm] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Omit<Project, 'id'> | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [showEmailTemplate, setShowEmailTemplate] = useState(false)

  // Queries
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => projects.get(projectId) })
  const { data: program } = useQuery({
    queryKey: ['program', project?.program_id],
    queryFn: () => programs.get(project!.program_id!),
    enabled: !!project?.program_id,
  })
  const { data: milestonesDetail = [] } = useQuery({ queryKey: ['milestones-detail', projectId], queryFn: () => projects.milestonesDetail(projectId) })
  const { data: drift = [] } = useQuery({ queryKey: ['drift', projectId], queryFn: () => projects.drift(projectId) })
  const { data: suggestions = [] } = useQuery({ queryKey: ['suggestions', projectId], queryFn: () => projects.suggestions(projectId) })
  const { data: invoiceList = [] } = useQuery({ queryKey: ['invoices', projectId], queryFn: () => projects.invoices(projectId) })
  const { data: memberships = [] } = useQuery({ queryKey: ['memberships', projectId], queryFn: () => projects.memberships(projectId) })
  const { data: billingPositions = [] } = useQuery({ queryKey: ['billingPositions', projectId], queryFn: () => projects.billingPositions(projectId) })
  const { data: personList = [] } = useQuery({ queryKey: ['persons'], queryFn: () => persons.list() })
  const { data: programList = [] } = useQuery({ queryKey: ['programs'], queryFn: () => programs.list() })
  const personName = (pid: number) => personList.find((p) => p.id === pid)?.name ?? String(pid)

  // Mutations
  const invalidateMilestones = () => {
    qc.invalidateQueries({ queryKey: ['milestones', projectId] })
    qc.invalidateQueries({ queryKey: ['milestones-detail', projectId] })
  }

  const initMilestones = useMutation({
    mutationFn: (force?: boolean) => projects.initMilestones(projectId, force),
    onSuccess: invalidateMilestones,
  })

  const updatePersonBudget = useMutation({
    mutationFn: ({ milestoneId, personId, hours }: { milestoneId: number; personId: number; hours: number }) =>
      projects.updatePersonBudget(projectId, milestoneId, personId, hours),
    onSuccess: () => { invalidateMilestones(); setEditBudget(null) },
    onError: (e: Error) => setError(e.message),
  })
  const applyRebalancing = useMutation({
    mutationFn: () => projects.applyRebalancing(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      qc.invalidateQueries({ queryKey: ['suggestions', projectId] })
    },
  })
  const closeMonth = useMutation({
    mutationFn: () => projects.closeMonth(projectId, closeForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', projectId] })
      invalidateMilestones()
      setShowCloseModal(false)
      setError(null)
    },
    onError: (e: Error) => setError(e.message),
  })
  const reopenInvoice = useMutation({
    mutationFn: (id: number) => invoiceApi.reopen(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', projectId] })
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
    },
  })
  const advanceStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: MonthlyInvoice['status'] }) =>
      invoiceApi.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices', projectId] }),
  })
  const addMember = useMutation({
    mutationFn: () => projects.addMembership(projectId, addMemberForm),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memberships', projectId] })
      setShowAddMember(false)
      setError(null)
      if (result.warnings && result.warnings.length > 0) {
        setMemberWarnings(result.warnings)
      }
    },
    onError: (e: Error) => setError(e.message),
  })
  const updateMember = useMutation({
    mutationFn: () => projects.updateMembership(projectId, editMember!.id, editMemberForm),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memberships', projectId] })
      setEditMember(null)
      setError(null)
      if (result.warnings && result.warnings.length > 0) setMemberWarnings(result.warnings)
    },
    onError: (e: Error) => setError(e.message),
  })
  const removeMember = useMutation({
    mutationFn: (mid: number) => projects.deleteMembership(projectId, mid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships', projectId] }),
  })

  const updateProject = useMutation({
    mutationFn: (data: Omit<Project, 'id'>) => projects.update(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    },
    onError: (e: Error) => setError(e.message),
  })

  const addBillingPosition = useMutation({
    mutationFn: (d: Parameters<typeof projects.addBillingPosition>[1]) =>
      projects.addBillingPosition(projectId, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billingPositions', projectId] }),
    onError: (e: Error) => setError(e.message),
  })

  const deleteBillingPosition = useMutation({
    mutationFn: (bpId: number) => projects.deleteBillingPosition(projectId, bpId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billingPositions', projectId] }),
    onError: (e: Error) => setError(e.message),
  })

  if (!project) return <div className="p-6 text-sm text-gray-400">Lade…</div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'milestones', label: 'Meilensteine' },
    { id: 'rebalancing', label: 'Rebalancing' },
    { id: 'invoices', label: 'Rechnungen' },
    { id: 'members', label: 'Mitglieder' },
    { id: 'bookings', label: 'Buchungen' },
    { id: 'settings', label: 'Einstellungen' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <button onClick={() => navigate('/projects')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ChevronLeft size={14} /> Projekte
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">{project.name}</h2>
              <span className="text-sm text-gray-400">{project.project_number}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {project.start_date} – {project.end_date} · {project.total_budget_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              {project.total_budget_hours != null && (
                <> · {project.total_budget_hours.toLocaleString('de-DE')} Std.</>
              )}
            </p>
            {program && (
              <p className="text-xs text-gray-400 mt-0.5">Hauptprojekt: {program.program_number} – {program.name}</p>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-0 mt-4 border-b border-gray-200 -mb-px">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
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

        {/* ── Milestones ── */}
        {tab === 'milestones' && (() => {
          const toggleExpand = (id: number) => {
            setExpandedMilestones((prev) => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })
          }
          const totals = milestonesDetail.reduce(
            (acc, d: MilestoneDetail) => ({
              initial: acc.initial + d.milestone.initial_hours,
              current: acc.current + d.milestone.current_hours,
              planEuros: acc.planEuros + d.persons.reduce((s, p) => s + p.initial_hours * p.billing_rate_per_hour, 0),
              currentEuros: acc.currentEuros + d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0),
            }),
            { initial: 0, current: 0, planEuros: 0, currentEuros: 0 },
          )
          return (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-medium text-gray-700">Monatliche Meilensteine</h3>
                <button onClick={() => {
                  if (memberships.length === 0) {
                    setError('Bitte zuerst Mitglieder anlegen, bevor Meilensteine initialisiert werden.')
                  } else if (milestonesDetail.length > 0) {
                    setShowReinitConfirm(true)
                  } else {
                    initMilestones.mutate(false)
                  }
                }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                  <RefreshCw size={14} /> Initialisieren
                </button>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-6"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monat</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Geplante Stunden bei Initialisierung (verfügbare Kapazität × Budget-Skalierung)">Plan (Std.)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Aktuell geplante Stunden inkl. manueller Anpassungen. Fortschrittsbalken = gebuchte / geplante Stunden.">Aktuell (Std.)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Budgetanteil dieses Monats in €: Summe(Plan-Std. × Stundensatz)">Plan (€)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Aktuell geplante Kosten: Summe(Aktuell-Std. × Stundensatz)">Aktuell (€)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {milestonesDetail.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Meilensteine. Bitte initialisieren.</td></tr>
                    )}
                    {milestonesDetail.map((d: MilestoneDetail) => {
                      const ms = d.milestone
                      const expanded = expandedMilestones.has(ms.id)
                      const planEuros = d.persons.reduce((s, p) => s + p.initial_hours * p.billing_rate_per_hour, 0)
                      const currentEuros = d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0)
                      const bookedEuros = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0) * p.billing_rate_per_hour, 0)
                      const totalBooked = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0)
                      const pct = ms.current_hours > 0 ? Math.min(150, (totalBooked / ms.current_hours) * 100) : 0
                      const barColor = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const eurPct = currentEuros > 0 ? Math.min(150, (bookedEuros / currentEuros) * 100) : 0
                      const eurBarColor = eurPct > 100 ? 'bg-red-500' : eurPct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const fmtEur = (n: number) => n > 0 ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : null
                      return [
                        <tr key={ms.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(ms.id)}>
                          <td className="px-4 py-3 text-gray-400">
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-700">{MONTH_NAMES[ms.month]} {ms.year}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{ms.initial_hours.toFixed(1)} h</td>
                          <td className="px-4 py-3">
                            <div className="min-w-[9rem]">
                              <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>{totalBooked.toFixed(1)} h</span>
                                <span>{ms.current_hours.toFixed(1)} h</span>
                              </div>
                              <div className="relative w-full h-4 bg-gray-100 rounded overflow-hidden">
                                <div className={`h-full rounded ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                {pct > 0 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white mix-blend-difference pointer-events-none">
                                    {Math.round(pct)} %
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {fmtEur(planEuros) ?? <span className="text-gray-300">–</span>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-[9rem]">
                              <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>{fmtEur(bookedEuros) ?? '0 €'}</span>
                                <span>{fmtEur(currentEuros) ?? '–'}</span>
                              </div>
                              <div className="relative w-full h-4 bg-gray-100 rounded overflow-hidden">
                                <div className={`h-full rounded ${eurBarColor}`} style={{ width: `${Math.min(100, eurPct)}%` }} />
                                {eurPct > 0 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white mix-blend-difference pointer-events-none">
                                    {Math.round(eurPct)} %
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ms.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                              {ms.status === 'closed' ? 'Abgeschlossen' : 'Offen'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              {ms.is_locked ? <Lock size={13} className="text-gray-400" /> : <Unlock size={13} className="text-gray-300" />}
                              {ms.status === 'open' && !ms.is_locked && (
                                <button
                                  onClick={() => {
                                    const form = { year: ms.year, month: ms.month, billing_position_id: billingPositions[0]?.id ?? 0 }
                                    const warnings: string[] = []
                                    if (ms.current_hours > 0 && totalBooked < ms.current_hours * 0.8) {
                                      warnings.push(`Nur ${totalBooked.toFixed(1)} von ${ms.current_hours.toFixed(1)} h gebucht (${Math.round(totalBooked / ms.current_hours * 100)} %)`)
                                    }
                                    d.persons.forEach((p) => {
                                      if (p.booked_hours === 0) warnings.push(`${p.person_name}: keine Buchungen vorhanden`)
                                    })
                                    if (warnings.length > 0) {
                                      setCloseWarnings(warnings)
                                      setPendingCloseForm(form)
                                    } else {
                                      setCloseForm(form)
                                      setShowCloseModal(true)
                                    }
                                  }}
                                  className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                                  Abschließen
                                </button>
                              )}
                              {ms.status === 'closed' && (
                                <button
                                  onClick={() => setConfirmReopenMilestone({ year: ms.year, month: ms.month })}
                                  className="text-xs text-orange-500 hover:underline whitespace-nowrap">
                                  Öffnen
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>,
                        expanded && d.persons.length > 0 && (
                          <tr key={`${ms.id}-persons`}>
                            <td colSpan={9} className="p-0">
                              <table className="w-full bg-slate-50 border-t border-slate-100">
                                <thead>
                                  <tr className="text-xs text-gray-400 border-b border-slate-100">
                                    <th className="pl-12 pr-4 py-1.5 text-left font-normal">Person</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Verfügbare Kapazität: Arbeitstage × h/Woche minus Abwesenheits- und Urlaubsschätzung">Verfügbarkeit</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Geplante Stunden (Budget-proportional verteilt)">Plan</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Aktuell geplante Stunden (manuell anpassbar)">Aktuell</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Aus Sage importierte Buchungen">Gebucht</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Effektive Personenwochenstunden: Aktuell ÷ (Arbeitstage / Tage-je-Woche). Zeigt den impliziten wöchentlichen Aufwand aus den geplanten Stunden.">Eff. PWS</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Abweichung der effektiven PWS zur Ziel-PWS aus der Projektmitgliedschaft.">Δ PWS</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Arbeitstage im Monat (Mo–Fr, exkl. Feiertage)">Arbeitstage</th>
                                    <th className="px-4 py-1.5 text-left font-normal">Abwesenheit</th>
                                    <th className="px-4 py-1.5 text-left font-normal">Feiertage</th>
                                    <th className="px-4 py-1.5"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.persons.map((p) => {
                                    const targetPws = memberships.find(m => m.person_id === p.person_id)?.weekly_capacity_hours ?? null
                                    const dpw = p.days_per_week ?? 5
                                    const effPws = p.work_days > 0 ? p.current_hours * dpw / p.work_days : null
                                    const deltaPws = effPws !== null && targetPws !== null ? effPws - targetPws : null
                                    const avail = p.available_hours ?? null
                                    const planOverbooked = avail !== null && p.initial_hours > avail + 0.1
                                    const planUnderbooked = avail !== null && p.initial_hours < avail - 0.1
                                    return (
                                    <tr key={p.person_id} className="text-sm border-b border-slate-100 last:border-0">
                                      <td className="pl-12 pr-4 py-2 text-gray-700">{p.person_name}</td>
                                      <td className="px-4 py-2 text-gray-400">{avail !== null ? `${avail.toFixed(1)} h` : <span className="text-gray-300">–</span>}</td>
                                      <td className={`px-4 py-2 font-medium ${planOverbooked ? 'text-red-600' : planUnderbooked ? 'text-blue-600' : 'text-gray-500'}`}
                                          title={planOverbooked ? 'Überbucht: Plan übersteigt verfügbare Kapazität' : planUnderbooked ? 'Unterbucht: Plan liegt unter verfügbarer Kapazität' : undefined}>
                                        {p.initial_hours.toFixed(1)} h
                                      </td>
                                      <td className="px-4 py-2 text-gray-700 font-medium">{p.current_hours.toFixed(1)} h</td>
                                      <td className="px-4 py-2 text-gray-500">{(p.booked_hours ?? 0).toFixed(1)} h</td>
                                      <td className="px-4 py-2 text-gray-600 font-medium">
                                        {effPws !== null ? `${effPws.toFixed(1)} h/W` : <span className="text-gray-300">–</span>}
                                      </td>
                                      <td className="px-4 py-2 font-medium">
                                        {deltaPws !== null
                                          ? <span className={deltaPws > 0.05 ? 'text-orange-600' : deltaPws < -0.05 ? 'text-blue-600' : 'text-green-600'}>
                                              {deltaPws > 0 ? '+' : ''}{deltaPws.toFixed(1)} h/W
                                            </span>
                                          : <span className="text-gray-300">–</span>}
                                      </td>
                                      <td className="px-4 py-2 text-gray-500">{p.work_days} T</td>
                                      <td className="px-4 py-2 text-gray-500">{p.absence_days} T</td>
                                      <td className="px-4 py-2 text-gray-500">{p.holiday_days} T</td>
                                      <td className="px-4 py-2">
                                        {ms.status === 'open' && !ms.is_locked && (
                                          <button
                                            onClick={() => { setEditBudget({ milestoneId: ms.id, personId: p.person_id, personName: p.person_name, currentHours: p.current_hours }); setEditHours(p.current_hours) }}
                                            className="p-1 text-gray-400 hover:text-blue-600">
                                            <Pencil size={12} />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ),
                      ]
                    })}
                    {milestonesDetail.length > 0 && (
                      <tr className="bg-gray-50 font-semibold text-sm border-t-2 border-gray-200">
                        <td></td>
                        <td className="px-4 py-3 text-gray-700">Gesamt</td>
                        <td className="px-4 py-3 text-gray-700">{totals.initial.toFixed(1)} h</td>
                        <td className="px-4 py-3 text-gray-700">{totals.current.toFixed(1)} h</td>
                        <td className="px-4 py-3 text-gray-700">
                          {totals.planEuros > 0 ? totals.planEuros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '–'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {totals.currentEuros > 0 ? totals.currentEuros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '–'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm font-normal">
                          Vertrag: {project.total_budget_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          {project.total_budget_hours != null && <><br/>{project.total_budget_hours.toLocaleString('de-DE')} h</>}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        {/* ── Rebalancing ── */}
        {tab === 'rebalancing' && (
          <div className="space-y-6">
            {/* Drift summary */}
            <div>
              <h3 className="font-medium text-gray-700 mb-3">Abweichung (Ist vs. Plan)</h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Person', 'Geplant', 'Gebucht', 'Abweichung'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {drift.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">Keine Daten. Meilensteine initialisieren und Sage-Import durchführen.</td></tr>
                    )}
                    {drift.map((d) => (
                      <tr key={d.person_id}>
                        <td className="px-4 py-3 text-sm text-gray-700">{personName(d.person_id)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.planned_hours.toFixed(1)} h</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.actual_hours.toFixed(1)} h</td>
                        <td className={`px-4 py-3 text-sm font-medium ${d.drift_hours > 0 ? 'text-red-600' : d.drift_hours < 0 ? 'text-amber-600' : 'text-gray-600'}`}>
                          {d.drift_hours > 0 ? '+' : ''}{d.drift_hours.toFixed(1)} h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Suggestions + apply */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium text-gray-700">Verteilungsvorschlag (offene Monate)</h3>
                <button onClick={() => applyRebalancing.mutate()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                  <TrendingUp size={14} /> Anwenden
                </button>
              </div>
              {suggestions.map((s) => (
                <div key={s.milestone_id} className="mb-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 text-sm font-medium text-gray-700 border-b">
                    {MONTH_NAMES[s.month]} {s.year} · Gesamt: {s.total_current_hours.toFixed(1)} h
                  </div>
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead>
                      <tr>
                        {['Person', 'Aktuell', 'Vorschlag', 'Δ'].map((h) => (
                          <th key={h} className="px-4 py-2 text-left text-xs text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {s.budgets.map((b) => (
                        <tr key={b.budget_id}>
                          <td className="px-4 py-2 text-sm text-gray-700">{personName(b.person_id)}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">{b.current_hours.toFixed(1)} h</td>
                          <td className="px-4 py-2 text-sm text-blue-600 font-medium">{b.suggested_hours.toFixed(1)} h</td>
                          <td className={`px-4 py-2 text-sm ${Math.abs(b.suggested_hours - b.current_hours) > 0.1 ? 'text-amber-600' : 'text-gray-400'}`}>
                            {(b.suggested_hours - b.current_hours) > 0 ? '+' : ''}{(b.suggested_hours - b.current_hours).toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {suggestions.length === 0 && (
                <p className="text-sm text-gray-400">Keine offenen Meilensteine vorhanden.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Invoices ── */}
        {tab === 'invoices' && (() => {
          const MONTH_FULL = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
          const totalInvoiced = invoiceList.reduce((s, inv) => s + inv.total_amount_euros, 0)
          const totalHoursInvoiced = invoiceList.reduce((s, inv) => s + inv.total_hours, 0)
          const rest = project.total_budget_euros - totalInvoiced
          const lastInv = [...invoiceList].sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)[0]
          const fmt = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

          const emailText = lastInv ? [
            `hier der Projektstatus zu Ende ${MONTH_FULL[lastInv.month - 1]} ${lastInv.year}:`,
            '',
            `Projekt ${project.project_number}:`,
            `Gesamt        | Summen`,
            `Budget        | ${fmt(project.total_budget_euros)}`,
            `Abgerechnet   | ${fmt(totalInvoiced)}`,
            `Rest          | ${fmt(rest)}`,
            '',
            `Der Rechnungsbetrag für ${MONTH_FULL[lastInv.month - 1]} lautet: ${fmt(lastInv.total_amount_euros)}`,
          ].join('\n') : ''

          return (
            <div className="space-y-4">
              {/* Budget summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Gesamtbudget</p>
                  <p className="text-lg font-semibold text-gray-800">{fmt(project.total_budget_euros)}</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Abgerechnet</p>
                  <p className="text-lg font-semibold text-blue-700">{fmt(totalInvoiced)}</p>
                  {totalHoursInvoiced > 0 && <p className="text-xs text-gray-400 mt-0.5">{totalHoursInvoiced.toFixed(1)} h</p>}
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs text-gray-500 mb-1">Restbudget</p>
                  <p className={`text-lg font-semibold ${rest < 0 ? 'text-red-700' : 'text-green-700'}`}>{fmt(rest)}</p>
                  {project.total_budget_euros > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">{Math.round((totalInvoiced / project.total_budget_euros) * 100)} % verbraucht</p>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center">
                <h3 className="font-medium text-gray-700">Monatliche Abrechnungen</h3>
                <button onClick={() => { setCloseForm({ ...closeForm, billing_position_id: billingPositions[0]?.id ?? 0 }); setShowCloseModal(true) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                  <FileText size={14} /> Monat abschließen
                </button>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Monat', 'Stunden', 'Betrag', 'Status', 'Aktionen'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoiceList.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Abrechnungen.</td></tr>
                    )}
                    {invoiceList.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-700">{MONTH_NAMES[inv.month]} {inv.year}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{inv.total_hours.toFixed(1)} h</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{inv.total_amount_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status]}`}>
                            {STATUS_LABELS[inv.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex gap-2">
                            {inv.status === 'planned' && (
                              <button onClick={() => advanceStatus.mutate({ id: inv.id, status: 'invoiced' })}
                                className="text-xs text-blue-600 hover:underline">Abrechnen</button>
                            )}
                            {inv.status === 'invoiced' && (
                              <button onClick={() => advanceStatus.mutate({ id: inv.id, status: 'paid' })}
                                className="text-xs text-green-600 hover:underline">Als bezahlt markieren</button>
                            )}
                            <button onClick={() => setConfirmReopenId(inv.id)}
                              className="text-xs text-gray-400 hover:text-red-500">Wiedereröffnen</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {invoiceList.length > 0 && (
                      <tr className="bg-gray-50 font-semibold text-sm border-t-2 border-gray-200">
                        <td className="px-4 py-2.5 text-gray-700">Gesamt</td>
                        <td className="px-4 py-2.5 text-gray-700">{totalHoursInvoiced.toFixed(1)} h</td>
                        <td className="px-4 py-2.5 text-gray-700">{fmt(totalInvoiced)}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Email template — collapsible */}
              {lastInv && (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setShowEmailTemplate((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <Mail size={14} /> Mail-Vorlage
                    </span>
                    <ChevronDown size={14} className={`transition-transform text-gray-400 ${showEmailTemplate ? '' : '-rotate-90'}`} />
                  </button>
                  {showEmailTemplate && (
                    <div className="border-t border-gray-100 p-4">
                      <div className="relative">
                        <textarea
                          readOnly
                          rows={9}
                          className="w-full font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3 pr-10 text-gray-700 resize-none focus:outline-none select-all"
                          value={emailText}
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(emailText)}
                          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-blue-600 bg-white rounded border border-gray-200 hover:border-blue-300 transition-colors"
                          title="In Zwischenablage kopieren"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5">Klick auf <Copy size={10} className="inline" /> kopiert den Text in die Zwischenablage.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Members ── */}
        {tab === 'members' && (
          <div>
            {memberWarnings.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-medium mb-1">Überbuchung erkannt</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      {memberWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                  <button onClick={() => setMemberWarnings([])} className="text-amber-600 hover:text-amber-800 text-xs shrink-0">✕</button>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium text-gray-700">Projektmitglieder</h3>
              <button onClick={() => setShowAddMember(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                <Plus size={14} /> Hinzufügen
              </button>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <Table
                columns={[
                  { key: 'person_id', header: 'Person', render: (m: ProjectMembership) => personName(m.person_id) },
                  { key: 'from_date', header: 'Von' },
                  { key: 'to_date', header: 'Bis' },
                  { key: 'weekly_capacity_hours', header: 'h/Woche', render: (m: ProjectMembership) => `${m.weekly_capacity_hours} h` },
                  { key: 'billing_rate_per_hour', header: 'Stundensatz', render: (m: ProjectMembership) => `${m.billing_rate_per_hour} €` },
                  {
                    key: 'actions', header: '',
                    render: (m: ProjectMembership) => (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditMember(m); setEditMemberForm({ from_date: m.from_date, to_date: m.to_date, weekly_capacity_hours: m.weekly_capacity_hours, billing_rate_per_hour: m.billing_rate_per_hour }); setError(null) }}
                          className="text-gray-400 hover:text-blue-500" aria-label="Bearbeiten"
                        ><Pencil size={14} /></button>
                        <button onClick={() => removeMember.mutate(m.id)}
                          className="text-gray-400 hover:text-red-500" aria-label="Entfernen"><Trash2 size={14} /></button>
                      </div>
                    ),
                  },
                ]}
                rows={memberships}
                keyFn={(m) => m.id}
              />
            </div>
          </div>
        )}

        {/* ── Bookings ── */}
        {tab === 'bookings' && (
          <BookingsTab projectId={projectId} memberships={memberships} />
        )}

        {/* ── Settings ── */}
        {tab === 'settings' && (() => {
          const sf = settingsForm ?? {
            project_number: project.project_number,
            name: project.name,
            description: project.description,
            start_date: project.start_date,
            end_date: project.end_date,
            total_budget_hours: project.total_budget_hours,
            total_budget_euros: project.total_budget_euros,
            holiday_country: project.holiday_country,
            holiday_state: project.holiday_state,
            status: project.status,
            program_id: project.program_id,
          }
          const setSf = (v: typeof sf) => setSettingsForm(v)
          return (
            <div className="max-w-lg">
              <h3 className="font-medium text-gray-700 mb-4">Projekteinstellungen</h3>
              <form onSubmit={(e) => { e.preventDefault(); updateProject.mutate(sf) }} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Projektname</label>
                  <input required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Projektnummer</label>
                  <input required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.project_number} onChange={(e) => setSf({ ...sf, project_number: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
                  <textarea rows={3} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.description} onChange={(e) => setSf({ ...sf, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
                    <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={sf.start_date} onChange={(e) => setSf({ ...sf, start_date: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
                    <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={sf.end_date} onChange={(e) => setSf({ ...sf, end_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Budget (€)</label>
                  <input required type="number" min={0} step={0.01} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.total_budget_euros} onChange={(e) => setSf({ ...sf, total_budget_euros: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Budget (Std.) <span className="font-normal text-gray-400">optional</span></label>
                  <input type="number" min={0} step={0.01} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.total_budget_hours ?? ''} onChange={(e) => setSf({ ...sf, total_budget_hours: e.target.value ? parseFloat(e.target.value) : null })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.status} onChange={(e) => setSf({ ...sf, status: e.target.value as Project['status'] })}>
                    <option value="planned">Geplant</option>
                    <option value="active">Aktiv</option>
                    <option value="completed">Abgeschlossen</option>
                    <option value="archived">Archiviert</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Hauptprojekt <span className="font-normal text-gray-400">optional</span></label>
                  <select className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.program_id ?? ''} onChange={(e) => setSf({ ...sf, program_id: e.target.value ? parseInt(e.target.value) : null })}>
                    <option value="">— kein Hauptprojekt —</option>
                    {(programList as Program[]).map((pg) => (
                      <option key={pg.id} value={pg.id}>{pg.program_number} – {pg.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button type="submit"
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                    Speichern
                  </button>
                  {settingsSaved && <span className="text-sm text-green-600">Gespeichert</span>}
                </div>
              </form>

              {/* Billing positions (PSP-Elemente) */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-1">Rechnungspositionen (PSP-Elemente)</h4>
                <p className="text-xs text-gray-400 mb-3">
                  Vertragspositionen, denen Monatsabrechnungen zugeordnet werden.
                  Für die meisten Projekte genügt eine Position.
                </p>

                {/* Existing positions */}
                {billingPositions.length > 0 && (
                  <div className="mb-3 bg-white rounded border border-gray-200 divide-y divide-gray-100">
                    {billingPositions.map((bp) => {
                      const inUse = invoiceList.some((inv) => inv.billing_position_id === bp.id)
                      return (
                        <div key={bp.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <div>
                            <span className="font-medium text-gray-700">{bp.position_number}</span>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span className="text-gray-600">{bp.description}</span>
                            {bp.budget_euros > 0 && (
                              <span className="ml-2 text-xs text-gray-400">
                                {bp.budget_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => deleteBillingPosition.mutate(bp.id)}
                            disabled={inUse || deleteBillingPosition.isPending}
                            title={inUse ? 'Wird von einer Abrechnung verwendet — kann nicht gelöscht werden' : 'Löschen'}
                            className="p-1 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Add new position */}
                <BillingPositionForm
                  onSave={(d) => addBillingPosition.mutate(d)}
                  isPending={addBillingPosition.isPending}
                />
              </div>
            </div>
          )
        })()}
      </div>

      {/* Close month modal */}
      {showCloseModal && (
        <Modal title="Monat abschließen" onClose={() => { setShowCloseModal(false); setError(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); closeMonth.mutate() }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
                <input type="number" required min={2000} max={2100}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={closeForm.year}
                  onChange={(e) => setCloseForm({ ...closeForm, year: parseInt(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monat</label>
                <select required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={closeForm.month}
                  onChange={(e) => setCloseForm({ ...closeForm, month: parseInt(e.target.value) })}>
                  {MONTH_NAMES.slice(1).map((name, i) => (
                    <option key={i + 1} value={i + 1}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
            {billingPositions.length === 0 && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                Keine Rechnungsposition vorhanden. Bitte zuerst eine PSP-Position unter den Projekteinstellungen anlegen.
              </p>
            )}
            {billingPositions.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Rechnungsposition (PSP-Element)
                  <span className="ml-1 font-normal text-gray-400">— welches Arbeitspaket wird abgerechnet?</span>
                </label>
                <select required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={closeForm.billing_position_id}
                  onChange={(e) => setCloseForm({ ...closeForm, billing_position_id: parseInt(e.target.value) })}>
                  <option value={0} disabled>— bitte wählen —</option>
                  {billingPositions.map((bp) => (
                    <option key={bp.id} value={bp.id}>{bp.position_number} – {bp.description}</option>
                  ))}
                </select>
              </div>
            )}
            {billingPositions.length === 1 && (
              <p className="text-xs text-gray-400">
                Rechnungsposition: <span className="text-gray-600 font-medium">{billingPositions[0].position_number} – {billingPositions[0].description}</span>
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowCloseModal(false); setError(null) }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                disabled={billingPositions.length === 0}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">Abschließen</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Close warning dialog */}
      {closeWarnings.length > 0 && (
        <Modal title="Warnung vor Abschluss" onClose={() => { setCloseWarnings([]); setPendingCloseForm(null) }}>
          <p className="text-sm text-gray-700 mb-3">Folgende Punkte wurden festgestellt:</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-700 mb-4">
            {closeWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setCloseWarnings([]); setPendingCloseForm(null) }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button onClick={() => {
              if (pendingCloseForm) setCloseForm(pendingCloseForm)
              setCloseWarnings([])
              setPendingCloseForm(null)
              setShowCloseModal(true)
            }}
              className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700">Trotzdem abschließen</button>
          </div>
        </Modal>
      )}

      {/* Re-initialize confirmation */}
      {showReinitConfirm && (
        <Modal title="Meilensteine initialisieren" onClose={() => setShowReinitConfirm(false)}>
          <p className="text-sm text-gray-700 mb-2">
            Es sind bereits {milestonesDetail.length} Meilensteine vorhanden.
          </p>
          <ul className="text-xs text-gray-500 mb-4 space-y-1 list-disc list-inside">
            <li><strong>Hinzufügen</strong> — ergänzt fehlende Monate, bestehende bleiben unverändert.</li>
            <li><strong>Neu berechnen</strong> — löscht alle offenen Meilensteine und berechnet sie neu nach aktuellem Budget und Kapazitäten. Gesperrte (abgerechnete) Monate bleiben erhalten.</li>
          </ul>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowReinitConfirm(false)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button onClick={() => { setShowReinitConfirm(false); initMilestones.mutate(false) }}
              className="px-4 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Hinzufügen</button>
            <button onClick={() => { setShowReinitConfirm(false); initMilestones.mutate(true) }}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Neu berechnen</button>
          </div>
        </Modal>
      )}

      {/* Edit person budget modal */}
      {editBudget && (
        <Modal title={`Stunden anpassen — ${editBudget.personName}`} onClose={() => setEditBudget(null)}>
          <form onSubmit={(e) => { e.preventDefault(); updatePersonBudget.mutate({ milestoneId: editBudget.milestoneId, personId: editBudget.personId, hours: editHours }) }} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Aktuelle Stunden</label>
              <input
                autoFocus
                required type="number" min={0} step={0.01}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editHours}
                onChange={(e) => setEditHours(parseFloat(e.target.value))}
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditBudget(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Reopen invoice confirmation */}
      {confirmReopenId !== null && (
        <Modal title="Monat wiedereröffnen" onClose={() => setConfirmReopenId(null)}>
          <p className="text-sm text-gray-700 mb-4">
            Dieser Monat ist bereits abgeschlossen. Trotzdem wiedereröffnen und die Abrechnung rückgängig machen?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmReopenId(null)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button onClick={() => { reopenInvoice.mutate(confirmReopenId); setConfirmReopenId(null) }}
              className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700">Wiedereröffnen</button>
          </div>
        </Modal>
      )}

      {/* Reopen milestone confirmation */}
      {confirmReopenMilestone !== null && (() => {
        const MONTH_NAMES_MS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
        const inv = invoiceList.find(i => i.year === confirmReopenMilestone.year && i.month === confirmReopenMilestone.month)
        return (
          <Modal title="Meilenstein öffnen" onClose={() => setConfirmReopenMilestone(null)}>
            <div className="text-sm text-gray-700 mb-4 space-y-2">
              <p>
                Der Meilenstein <strong>{MONTH_NAMES_MS[confirmReopenMilestone.month - 1]} {confirmReopenMilestone.year}</strong> ist abgeschlossen.
                {inv && inv.status !== 'planned' && (
                  <span className="text-orange-700"> Die zugehörige Abrechnung hat Status <strong>{inv.status === 'invoiced' ? 'Abgerechnet' : 'Bezahlt'}</strong>.</span>
                )}
              </p>
              <p>Meilenstein wirklich wieder öffnen?</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmReopenMilestone(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button onClick={() => {
                if (inv) { reopenInvoice.mutate(inv.id) }
                setConfirmReopenMilestone(null)
              }}
                className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700">
                Öffnen
              </button>
            </div>
          </Modal>
        )
      })()}

      {/* Add member modal */}
      {showAddMember && (
        <Modal title="Mitglied hinzufügen" onClose={() => { setShowAddMember(false); setError(null) }}>
          <form onSubmit={(e) => { e.preventDefault(); addMember.mutate() }} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Person</label>
              <select required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={addMemberForm.person_id}
                onChange={(e) => {
                  const pid = parseInt(e.target.value)
                  const person = personList.find((p) => p.id === pid)
                  setAddMemberForm({
                    ...addMemberForm,
                    person_id: pid,
                    billing_rate_per_hour: person?.default_billing_rate ?? addMemberForm.billing_rate_per_hour,
                  })
                }}>
                <option value={0} disabled>— bitte wählen —</option>
                {personList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
                <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={addMemberForm.from_date}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, from_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
                <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={addMemberForm.to_date}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, to_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">h/Woche</label>
                <input required type="number" min={0} max={60} step={0.01}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={addMemberForm.weekly_capacity_hours}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, weekly_capacity_hours: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Stundensatz (€)</label>
                <input required type="number" min={0} step={0.01}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={addMemberForm.billing_rate_per_hour}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, billing_rate_per_hour: parseFloat(e.target.value) })} />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowAddMember(false); setError(null) }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit membership modal */}
      {editMember && (
        <Modal title="Zuweisung bearbeiten" onClose={() => { setEditMember(null); setError(null) }}>
          <p className="text-xs text-gray-500 mb-3">Person: <strong>{personName(editMember.person_id)}</strong></p>
          <form onSubmit={(e) => { e.preventDefault(); updateMember.mutate() }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
                <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={editMemberForm.from_date}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, from_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
                <input required type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={editMemberForm.to_date}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, to_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">h/Woche</label>
                <input required type="number" min={0} max={60} step={0.01}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={editMemberForm.weekly_capacity_hours}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, weekly_capacity_hours: parseFloat(e.target.value) })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Stundensatz (€)</label>
                <input required type="number" min={0} step={0.01}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  value={editMemberForm.billing_rate_per_hour}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, billing_rate_per_hour: parseFloat(e.target.value) })} />
              </div>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setEditMember(null); setError(null) }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
