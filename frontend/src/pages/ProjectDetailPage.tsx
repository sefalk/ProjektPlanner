import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw, Lock, Unlock, TrendingUp, FileText, Plus, Trash2, ChevronDown, ChevronRight, Pencil, Flag, RotateCcw, Mail, Copy } from 'lucide-react'
import {
  projects, persons, programs, invoices as invoiceApi, bookings as bookingsApi, ApiError,
  type Project, type Program, type ProjectMembership, type MonthlyInvoice, type MilestoneDetail, type TimeBooking, type ExclusionReason,
} from '../api'
import Modal from '../components/Modal'
import Table from '../components/Table'
import PageIntro from '../components/PageIntro'
import HelpPopover from '../components/HelpPopover'
import { MILESTONE_INTRO, MilestoneHelpContent } from '../content/milestoneHelp'

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
  const [editMemberForm, setEditMemberForm] = useState({ from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90, priority: 0 })
  const [confirmReopenId, setConfirmReopenId] = useState<number | null>(null)
  const [confirmReopenMilestone, setConfirmReopenMilestone] = useState<{ year: number; month: number } | null>(null)
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set())
  const [editBudget, setEditBudget] = useState<{ milestoneId: number; personId: number; personName: string; currentHours: number } | null>(null)
  const [editHours, setEditHours] = useState(0)
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([])   // manual-edit warnings (V6)
  const [budgetNeedsConfirm, setBudgetNeedsConfirm] = useState(false)  // budget overrun awaiting confirm
  const [editTarget, setEditTarget] = useState<{ milestoneId: number; year: number; month: number } | null>(null)  // edit monthly € target
  const [editTargetAmount, setEditTargetAmount] = useState(0)
  const [targetWarnings, setTargetWarnings] = useState<string[]>([])
  const [closeForm, setCloseForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, billing_position_id: 0 })
  const [addMemberForm, setAddMemberForm] = useState({ person_id: 0, from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90, priority: 0 })
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
  const { data: recommendations = [] } = useQuery({ queryKey: ['recommendations', projectId], queryFn: () => projects.recommendations(projectId) })
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
    qc.invalidateQueries({ queryKey: ['suggestions', projectId] })
    qc.invalidateQueries({ queryKey: ['recommendations', projectId] })
  }

  const initMilestones = useMutation({
    mutationFn: (force?: boolean) => projects.initMilestones(projectId, force),
    onSuccess: invalidateMilestones,
    onError: (e: Error) => setError(e.message),
  })

  const resyncMilestones = useMutation({
    mutationFn: () => projects.resyncMilestones(projectId),
    onSuccess: invalidateMilestones,
    onError: (e: Error) => setError(e.message),
  })

  const updatePersonBudget = useMutation({
    mutationFn: ({ milestoneId, personId, hours, confirm }: { milestoneId: number; personId: number; hours: number; confirm?: boolean }) =>
      projects.updatePersonBudget(projectId, milestoneId, personId, hours, confirm),
    onSuccess: () => {
      invalidateMilestones()
      setEditBudget(null)
      setBudgetWarnings([])
      setBudgetNeedsConfirm(false)
    },
    onError: (e: unknown) => {
      // Budget overrun without confirm → 409 with a warnings payload (V6, §8.2).
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { detail?: { warnings?: string[] } }
        setBudgetWarnings(body?.detail?.warnings ?? ['Budget würde überschritten.'])
        setBudgetNeedsConfirm(true)
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
  })
  const setTargetBudget = useMutation({
    mutationFn: ({ milestoneId, amount }: { milestoneId: number; amount: number }) =>
      projects.setMilestoneTargetBudget(projectId, milestoneId, amount),
    onSuccess: (result) => {
      invalidateMilestones()
      setError(null)
      if (result.warnings && result.warnings.length > 0) {
        setTargetWarnings(result.warnings)  // keep dialog open to show the capacity warning
      } else {
        setEditTarget(null)
        setTargetWarnings([])
      }
    },
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
          const fmtEur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const fmtH = (n: number) => `${n.toFixed(2)} h`
          // Invoice (Ist) per closed month — what a locked month actually consumed of the
          // budget (§9.3), not its frozen plan.
          const invoiceByMonth = new Map(invoiceList.map((i) => [`${i.year}-${i.month}`, i]))
          const plannedCost = (d: MilestoneDetail) => d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0)
          // Budget-relevant € of a month: locked → invoiced Ist, open → planned current cost.
          // Summed this is the forecast (Prognose), which never exceeds the budget.
          const monthEuros = (d: MilestoneDetail) => {
            const inv = invoiceByMonth.get(`${d.milestone.year}-${d.milestone.month}`)
            return d.milestone.is_locked && inv != null ? inv.total_amount_euros : plannedCost(d)
          }
          const totals = milestonesDetail.reduce(
            (acc, d: MilestoneDetail) => ({
              current: acc.current + d.milestone.current_hours,
              booked: acc.booked + d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0),
              forecastEuros: acc.forecastEuros + monthEuros(d),
            }),
            { current: 0, booked: 0, forecastEuros: 0 },
          )
          const istEuros = invoiceList.reduce((s, i) => s + i.total_amount_euros, 0)  // abgerechnet
          const budget = project.total_budget_euros
          const deltaEuros = totals.forecastEuros - budget  // >0 = Überschreitung, <0 = Rest
          const overBudget = deltaEuros > 0.01
          // Per-member breakdown of current (Ziel) vs booked (Ist) hours across all months (F2).
          const perMember = new Map<number, { name: string; ziel: number; ist: number }>()
          for (const d of milestonesDetail) {
            for (const p of d.persons) {
              const e = perMember.get(p.person_id) ?? { name: p.person_name, ziel: 0, ist: 0 }
              e.ziel += p.current_hours
              e.ist += p.booked_hours ?? 0
              perMember.set(p.person_id, e)
            }
          }
          const memberBreakdown = [...perMember.values()].filter((e) => e.ziel > 0 || e.ist > 0)
          const suggestionByMs = new Map(suggestions.map((s) => [s.milestone_id, s]))
          const overlapsMonth = (m: ProjectMembership, y: number, mo: number) => {
            const ms = new Date(y, mo - 1, 1)
            const me = new Date(y, mo, 0)
            return new Date(m.from_date) <= me && new Date(m.to_date) >= ms
          }
          // "veraltet": an open milestone is missing a budget row for a member active that
          // month (member added/changed after the last (re)initialization) → resync needed.
          const isStale = milestonesDetail.some((d) =>
            !d.milestone.is_locked &&
            memberships.some((m) => overlapsMonth(m, d.milestone.year, d.milestone.month)
              && !d.persons.some((p) => p.person_id === m.person_id)))
          return (
            <div>
              <PageIntro
                text={MILESTONE_INTRO}
                helpTitle="Meilenstein-Planung — Hilfe"
                helpContent={<MilestoneHelpContent />}
              />
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-700">Monatliche Meilensteine</h3>
                  {isStale && (
                    <span title="Mitglieder wurden nach der letzten Initialisierung geändert. Resync gleicht die offenen Meilensteine an (manuelle Anpassungen bleiben erhalten)."
                      className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      veraltet
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {milestonesDetail.length > 0 && (
                    <button onClick={() => resyncMilestones.mutate()}
                      title="Offene Meilensteine an den aktuellen Mitglieder-Stand angleichen (nicht-destruktiv, manuelle Anpassungen bleiben erhalten)."
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                      <RotateCcw size={14} /> Resync
                    </button>
                  )}
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
              </div>
              {recommendations.length > 0 && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  <p className="font-medium mb-1">Auslastungs-Empfehlungen</p>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {recommendations.map((r) => (
                      <li key={r.person_id}>
                        <strong>{r.person_name}</strong> hat noch {r.free_weekly_hours.toFixed(1)} h/Woche freie Kapazität —
                        Projekt-Wochenstunden könnten um bis zu {r.recommended_additional_hours.toFixed(1)} h erhöht werden
                        (Budget-Spielraum: {r.budget_headroom_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}).
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-6"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monat</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          Aufwand (Std.)
                          <HelpPopover label="Aufwand erklären">
                            Abgeleiteter Zeitaufwand: Balken = gebuchte Ist- über geplanten Soll-Stunden. Stunden folgen aus dem €-Budget, sind selbst keine harte Grenze.
                          </HelpPopover>
                        </span>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          Budget (€)
                          <HelpPopover label="Budget-€ erklären">
                            Führendes €-Budget: Balken = gebuchte Ist- über geplanten Soll-Kosten. Offene Monate: Soll = Ziel (editierbar); abgeschlossene: abgerechneter Ist-Betrag. Summe = Prognose (≤ Budget).
                          </HelpPopover>
                        </span>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {milestonesDetail.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Meilensteine. Bitte initialisieren.</td></tr>
                    )}
                    {milestonesDetail.map((d: MilestoneDetail) => {
                      const ms = d.milestone
                      const expanded = expandedMilestones.has(ms.id)
                      const plannedEuros = d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0)
                      // Soll €: open month → the target (editable) or the planned cost; closed → invoiced Ist.
                      const sollEuros = ms.is_locked ? monthEuros(d) : (ms.target_budget_euros ?? plannedEuros)
                      const bookedEuros = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0) * p.billing_rate_per_hour, 0)
                      const totalBooked = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0)
                      const pct = ms.current_hours > 0 ? Math.min(150, (totalBooked / ms.current_hours) * 100) : 0
                      const barColor = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const eurPct = sollEuros > 0 ? Math.min(150, (bookedEuros / sollEuros) * 100) : 0
                      const eurBarColor = eurPct > 100 ? 'bg-red-500' : eurPct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const sug = suggestionByMs.get(ms.id)
                      const rebalDelta = sug ? sug.suggested_total_hours - ms.current_hours : 0
                      return [
                        <tr key={ms.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(ms.id)}>
                          <td className="px-4 py-3 text-gray-400">
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-700">
                            <div className="flex items-center gap-1.5">
                              <span>{MONTH_NAMES[ms.month]} {ms.year}</span>
                              {d.warnings.length > 0 && (
                                <span title={d.warnings.join('\n')} className="text-amber-500" aria-label="Warnung">
                                  <Flag size={12} />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-[9rem]">
                              <div className="flex justify-end text-xs text-gray-500 mb-1">
                                <span>{fmtH(ms.current_hours)} <span className="text-[10px] text-gray-400">(Soll)</span></span>
                              </div>
                              <div className="relative w-full h-6 bg-gray-100 rounded overflow-hidden">
                                <div className={`h-full rounded ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                                {pct > 0 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white mix-blend-difference pointer-events-none">
                                    {fmtH(totalBooked)} · {Math.round(pct)} %
                                  </span>
                                )}
                              </div>
                              {sug && !ms.is_locked && Math.abs(rebalDelta) > 0.1 && (
                                <div className="mt-1 text-[11px] text-amber-600" title="Vorschlag aus dem Rebalancing (Budget-Ausschöpfung). Im Tab Rebalancing anwenden.">
                                  Rebalanciert: {fmtH(sug.suggested_total_hours)} ({rebalDelta > 0 ? '+' : ''}{rebalDelta.toFixed(2)})
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-[9rem]">
                              <div className="flex justify-end items-center gap-1 text-xs text-gray-500 mb-1">
                                <span>{sollEuros > 0 ? fmtEur(sollEuros) : '–'}</span>
                                <span className="text-[10px] text-gray-400">({ms.is_locked ? 'Ist' : 'Soll'})</span>
                                {!ms.is_locked && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditTarget({ milestoneId: ms.id, year: ms.year, month: ms.month }); setEditTargetAmount(Math.round(sollEuros * 100) / 100); setTargetWarnings([]) }}
                                    title="Budget-Ziel dieses Monats setzen (verteilt die Stunden automatisch)"
                                    className="p-0.5 text-gray-400 hover:text-blue-600">
                                    <Pencil size={11} />
                                  </button>
                                )}
                              </div>
                              <div className="relative w-full h-6 bg-gray-100 rounded overflow-hidden">
                                <div className={`h-full rounded ${eurBarColor}`} style={{ width: `${Math.min(100, eurPct)}%` }} />
                                {eurPct > 0 && (
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white mix-blend-difference pointer-events-none">
                                    {fmtEur(bookedEuros)} · {Math.round(eurPct)} %
                                  </span>
                                )}
                              </div>
                              {ms.target_budget_euros != null && !ms.is_locked && (
                                <div className="mt-1 text-[10px] text-blue-500" title="Manuell gesetztes Budget-Ziel (Sync mit externem System)">Ziel gesetzt</div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col items-start gap-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ms.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                                {ms.is_locked ? <Lock size={11} /> : <Unlock size={11} className="text-green-600" />}
                                {ms.status === 'closed' ? 'Abgeschlossen' : 'Offen'}
                              </span>
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
                            <td colSpan={5} className="p-0">
                              <table className="w-full bg-slate-50 border-t border-slate-100">
                                <thead>
                                  <tr className="text-xs text-gray-400 border-b border-slate-100">
                                    <th className="pl-12 pr-4 py-1.5 text-left font-normal">Person</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Netto planbare Kapazität auf Basis der im Projekt festgelegten Projekt-Wochenstunden dieses MA (nicht der allgemeinen Arbeitszeit): Arbeitstage × Projekt-h/Woche minus Feiertage, Abwesenheiten und Rest-Urlaubsschätzung. Ungenutzte allgemeine Kapazität erscheint separat als Empfehlung.">Verfügbar</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Balken = gebuchte Ist- über geplanten Soll-Stunden. Stift = Soll-Stunden dieser Person anpassen.">Aufwand (Std.)</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Personenwochenstunden: Ziel aus der Projektmitgliedschaft vs. effektiver Ist-Wert (Soll-Std. ÷ Arbeitstage × Tage/Woche).">PWS (Ziel / Ist)</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Arbeitstage (AT, Mo–Fr exkl. Feiertage) · geplante Abwesenheit (gepl., aus Abwesenheits-Einträgen) · geschätzte Abwesenheit (gesch., Resturlaub anteilig + pauschal Krank/Fortbildung) · Feiertage (FT)">Tage (AT · gepl. · gesch. · FT)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.persons.map((p) => {
                                    const targetPws = memberships.find(m => m.person_id === p.person_id)?.weekly_capacity_hours ?? null
                                    const avail = p.available_hours ?? null
                                    const booked = p.booked_hours ?? 0
                                    const cur = p.current_hours
                                    // Effective PWS = utilisation of the AVAILABLE capacity (which already accounts
                                    // for holidays + planned + estimated absences) scaled to the target → Ist = Ziel
                                    // at full utilisation, > Ziel when overbooked. Consistent with "Verfügbar".
                                    const effPws = avail !== null && avail > 0 && targetPws !== null ? (cur / avail) * targetPws : null
                                    const deltaPws = effPws !== null && targetPws !== null ? effPws - targetPws : null
                                    const estAbs = p.estimated_absence_days ?? 0
                                    // Planning bar: booked (Ist) fill over the current-plan (Soll) track.
                                    const bookedPct = cur > 0 ? Math.min(100, booked / cur * 100) : 0
                                    const barColor = booked > cur + 0.01 ? 'bg-red-500' : booked >= cur * 0.8 ? 'bg-orange-400' : 'bg-blue-500'
                                    const editable = ms.status === 'open' && !ms.is_locked
                                    // Suppress the per-person "M" badge when the whole month is target-driven
                                    // (all rows are override there — the milestone-level "Ziel gesetzt" says it instead).
                                    const showOverrideBadge = p.is_manual_override && ms.target_budget_euros == null
                                    // PWS gauge: target vs effective (Ist) as vertical markers, delta as a segment.
                                    const pwsMax = Math.max(targetPws ?? 0, effPws ?? 0, 1) * 1.15
                                    const tPos = targetPws !== null ? Math.min(100, targetPws / pwsMax * 100) : null
                                    const iPos = effPws !== null ? Math.min(100, effPws / pwsMax * 100) : null
                                    const deltaColor = deltaPws === null ? '' : deltaPws > 0.05 ? 'text-orange-600' : deltaPws < -0.05 ? 'text-blue-600' : 'text-green-600'
                                    return (
                                    <tr key={p.person_id} className="text-sm border-b border-slate-100 last:border-0">
                                      <td className="pl-12 pr-4 py-2 text-gray-700 whitespace-nowrap">
                                        {p.person_name}
                                        {showOverrideBadge && (
                                          <span title="Manuell angepasst — bleibt beim Resync erhalten"
                                            className="ml-1.5 px-1 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 align-middle">
                                            M
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{avail !== null ? fmtH(avail) : <span className="text-gray-300">–</span>}</td>
                                      <td className="px-4 py-2">
                                        <div className="min-w-[11rem]">
                                          <div className="flex justify-end items-center gap-1 text-[11px] text-gray-500 mb-1">
                                            <span>{fmtH(cur)} <span className="text-[10px] text-gray-400">(Soll)</span></span>
                                            {editable && (
                                              <button
                                                onClick={() => { setEditBudget({ milestoneId: ms.id, personId: p.person_id, personName: p.person_name, currentHours: p.current_hours }); setEditHours(p.current_hours) }}
                                                title="Soll-Stunden dieser Person anpassen"
                                                className="p-0.5 text-gray-400 hover:text-blue-600">
                                                <Pencil size={11} />
                                              </button>
                                            )}
                                          </div>
                                          <div className="relative w-full h-6 bg-gray-100 rounded overflow-hidden">
                                            <div className={`h-full rounded ${barColor}`} style={{ width: `${bookedPct}%` }} />
                                            {cur > 0 && (
                                              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white mix-blend-difference pointer-events-none">
                                                {fmtH(booked)} · {Math.round(bookedPct)} %
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2">
                                        {tPos !== null || iPos !== null ? (
                                          <div className="min-w-[9rem]">
                                            <div className="relative h-5 bg-gray-100 rounded">
                                              {tPos !== null && iPos !== null && (
                                                <div className={`absolute top-1/2 -translate-y-1/2 h-0.5 ${deltaPws! > 0 ? 'bg-orange-400' : 'bg-blue-400'}`}
                                                  style={{ left: `${Math.min(tPos, iPos)}%`, width: `${Math.abs(iPos - tPos)}%` }} />
                                              )}
                                              {tPos !== null && (
                                                <div className="absolute top-0 bottom-0 w-0.5 bg-gray-500" style={{ left: `${tPos}%` }} title={`Ziel-PWS ${targetPws?.toFixed(2)} h/W`} />
                                              )}
                                              {iPos !== null && (
                                                <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-500" style={{ left: `${iPos}%` }} title={`Ist eff. PWS ${effPws?.toFixed(2)} h/W`} />
                                              )}
                                            </div>
                                            <div className="flex justify-between text-[10px] mt-0.5">
                                              <span className="text-gray-500">Ziel {targetPws !== null ? targetPws.toFixed(1) : '–'}</span>
                                              <span className="text-emerald-600">Ist {effPws !== null ? effPws.toFixed(1) : '–'}</span>
                                              <span className={deltaColor}>{deltaPws !== null ? `${deltaPws > 0 ? '+' : ''}${deltaPws.toFixed(1)}` : ''}</span>
                                            </div>
                                          </div>
                                        ) : <span className="text-gray-300">–</span>}
                                      </td>
                                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap" title={`Arbeitstage ${p.work_days} · geplante Abwesenheit ${p.absence_days} · geschätzte Abwesenheit ${estAbs.toFixed(1)} (Resturlaub anteilig + pauschal Krank/Fortbildung) · Feiertage ${p.holiday_days}`}>
                                        {p.work_days} · {p.absence_days} · <span className="text-gray-400">~{estAbs.toFixed(1)}</span> · {p.holiday_days}
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
                      <tr className="bg-gray-50 font-semibold text-sm border-t-2 border-gray-200 align-top">
                        <td></td>
                        <td className="px-4 py-3 text-gray-700">Gesamt</td>
                        {/* F2: total current hours + per-member Ist/Ziel breakdown */}
                        <td className="px-4 py-3 text-gray-700">
                          <div>{fmtH(totals.current)}</div>
                          <div className="text-xs font-normal text-gray-400">
                            gebucht {fmtH(totals.booked)}
                          </div>
                          {memberBreakdown.length > 0 && (
                            <div className="mt-1.5 space-y-0.5 font-normal">
                              {memberBreakdown.map((e) => (
                                <div key={e.name} className="text-[11px] text-gray-500 whitespace-nowrap"
                                  title="Ist (gebucht) / Ziel (aktuell geplant), Summe über alle Monate">
                                  {e.name}: <span className="text-gray-600">{e.ist.toFixed(2)}</span> / {e.ziel.toFixed(2)} h
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        {/* F1: differentiated budget view */}
                        <td className="px-4 py-3">
                          <div className="space-y-0.5 font-normal">
                            <div className="flex justify-between gap-4">
                              <span className="text-gray-400 text-xs">Abgerechnet (Ist)</span>
                              <span className="text-gray-600">{fmtEur(istEuros)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className={`text-xs ${overBudget ? 'text-red-600' : 'text-gray-500'}`}>Prognose</span>
                              <span className={`font-semibold ${overBudget ? 'text-red-600' : deltaEuros < -0.01 ? 'text-amber-600' : 'text-gray-700'}`}>{fmtEur(totals.forecastEuros)}</span>
                            </div>
                            <div className="flex justify-between gap-4">
                              <span className="text-gray-400 text-xs">Vertrag (Ziel)</span>
                              <span className="text-gray-600">{fmtEur(budget)}</span>
                            </div>
                            <div className="flex justify-between gap-4 border-t border-gray-200 pt-0.5">
                              <span className={`text-xs ${overBudget ? 'text-red-600' : deltaEuros < -0.01 ? 'text-amber-600' : 'text-gray-500'}`}>
                                {overBudget ? 'Überschreitung' : 'Restbudget'}
                              </span>
                              <span className={`font-medium ${overBudget ? 'text-red-600' : deltaEuros < -0.01 ? 'text-amber-600' : 'text-gray-700'}`}>
                                {/* Restbudget = Vertrag − Prognose (positiv = übrig); Überschreitung = Prognose − Vertrag */}
                                {overBudget ? '+' : ''}{fmtEur(Math.abs(deltaEuros))}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td></td>
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
                    {MONTH_NAMES[s.month]} {s.year} · Aktuell: {s.total_current_hours.toFixed(1)} h
                    <span className="text-blue-600"> · Vorschlag: {s.suggested_total_hours.toFixed(1)} h</span>
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
                    key: 'priority', header: 'Priorität',
                    render: (m: ProjectMembership) => (
                      <span title="Budget-Priorität: kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral">
                        {m.priority === 0 ? <span className="text-gray-300">–</span> : m.priority}
                      </span>
                    ),
                  },
                  {
                    key: 'actions', header: '',
                    render: (m: ProjectMembership) => (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditMember(m); setEditMemberForm({ from_date: m.from_date, to_date: m.to_date, weekly_capacity_hours: m.weekly_capacity_hours, billing_rate_per_hour: m.billing_rate_per_hour, priority: m.priority }); setError(null) }}
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
      {editBudget && (() => {
        const closeEdit = () => { setEditBudget(null); setBudgetWarnings([]); setBudgetNeedsConfirm(false) }
        return (
        <Modal title={`Stunden anpassen — ${editBudget.personName}`} onClose={closeEdit}>
          <form onSubmit={(e) => { e.preventDefault(); updatePersonBudget.mutate({ milestoneId: editBudget.milestoneId, personId: editBudget.personId, hours: editHours }) }} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Aktuelle Stunden</label>
              <input
                autoFocus
                required type="number" min={0} step={0.01}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editHours}
                onChange={(e) => { setEditHours(parseFloat(e.target.value)); setBudgetNeedsConfirm(false); setBudgetWarnings([]) }}
              />
            </div>
            {budgetWarnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <p className="font-medium mb-1">{budgetNeedsConfirm ? 'Bestätigung erforderlich' : 'Hinweis'}</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {budgetWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeEdit}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              {budgetNeedsConfirm ? (
                <button type="button"
                  onClick={() => updatePersonBudget.mutate({ milestoneId: editBudget.milestoneId, personId: editBudget.personId, hours: editHours, confirm: true })}
                  className="px-4 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700">Trotzdem speichern</button>
              ) : (
                <button type="submit"
                  className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
              )}
            </div>
          </form>
        </Modal>
        )
      })()}

      {/* Edit monthly € target budget — drives hour distribution (sync with external system) */}
      {editTarget && (() => {
        const closeTarget = () => { setEditTarget(null); setTargetWarnings([]) }
        return (
        <Modal title={`Budget-Ziel anpassen — ${MONTH_NAMES[editTarget.month]} ${editTarget.year}`} onClose={closeTarget}>
          <form onSubmit={(e) => { e.preventDefault(); setTargetBudget.mutate({ milestoneId: editTarget.milestoneId, amount: editTargetAmount }) }} className="space-y-3">
            <p className="text-xs text-gray-500">
              Setze das €-Ziel dieses Monats (z. B. aus dem externen Abrechnungssystem). Die Stunden der
              Mitarbeiter werden automatisch so verteilt, dass das Ziel erreicht wird — begrenzt durch die
              verfügbare Kapazität.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Budget-Ziel (€)</label>
              <input
                autoFocus required type="number" min={0} step={0.01}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editTargetAmount}
                onChange={(e) => { setEditTargetAmount(parseFloat(e.target.value)); setTargetWarnings([]) }}
              />
            </div>
            {targetWarnings.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                <ul className="list-disc list-inside space-y-0.5">
                  {targetWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={closeTarget}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                {targetWarnings.length > 0 ? 'Schließen' : 'Abbrechen'}
              </button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern</button>
            </div>
          </form>
        </Modal>
        )
      })()}

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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Priorität <span className="text-gray-400 font-normal">(kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral)</span>
              </label>
              <input type="number" step={1}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={addMemberForm.priority}
                onChange={(e) => setAddMemberForm({ ...addMemberForm, priority: parseInt(e.target.value) || 0 })} />
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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Priorität <span className="text-gray-400 font-normal">(kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral)</span>
              </label>
              <input type="number" step={1}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={editMemberForm.priority}
                onChange={(e) => setEditMemberForm({ ...editMemberForm, priority: parseInt(e.target.value) || 0 })} />
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
