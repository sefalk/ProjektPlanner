import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw, Lock, Unlock, FileText, Plus, Trash2, ChevronDown, ChevronRight, Pencil, Flag, RotateCcw, Mail, Copy, AlertTriangle } from 'lucide-react'
import {
  projects, persons, programs, invoices as invoiceApi, bookings as bookingsApi, ApiError,
  type Project, type Program, type ProjectMembership, type MonthlyInvoice, type MilestoneDetail, type TimeBooking, type ExclusionReason, type BillingPosition,
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
  const { data: positions = [] } = useQuery({ queryKey: ['billingPositions', projectId], queryFn: () => projects.billingPositions(projectId) })
  const posById = new Map(positions.map((p) => [p.id, p]))
  const hasPositions = positions.length > 0

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
              {hasPositions && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Aufgelöster Projektposten (aus dem Projektebene→Posten-Mapping)">Posten</th>}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dauer (roh)</th>
              <SortTh k="net_hours" label="Std." />
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bemerkung</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={hasPositions ? 8 : 7} className="px-4 py-8 text-center text-sm text-gray-400">Keine Buchungen für diesen Filter.</td></tr>
            )}
            {sorted.map(b => (
              <tr key={b.id} className={b.is_excluded ? 'bg-red-50' : 'hover:bg-gray-50'}>
                <td className={`px-4 py-2.5 text-sm font-mono ${b.is_excluded ? 'text-red-400 line-through' : 'text-gray-700'}`}>{b.booking_date}</td>
                <td className={`px-4 py-2.5 text-sm ${b.is_excluded ? 'text-red-400 line-through' : 'text-gray-700'}`}>{b.person_name}</td>
                <td className={`px-4 py-2.5 text-sm ${b.is_excluded ? 'text-red-300 line-through' : 'text-gray-600'}`}>{b.sage_project_level}</td>
                {hasPositions && (
                  <td className="px-4 py-2.5 text-sm">
                    {b.billing_position_id != null
                      ? <span className="text-gray-700">{posById.get(b.billing_position_id)?.position_number ?? `#${b.billing_position_id}`}</span>
                      : <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700" title="Keinem Posten zugeordnet – Projektebene→Posten-Mapping prüfen">nicht zugeordnet</span>}
                  </td>
                )}
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
                <td colSpan={hasPositions ? 5 : 4} className="px-4 py-2.5 text-sm">Gesamt (aktiv)</td>
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

/** Extract the FastAPI `detail` string from an ApiError, falling back to the raw message. */
function errText(e: Error): string {
  if (e instanceof ApiError && e.body && typeof e.body === 'object' && 'detail' in e.body) {
    return String((e.body as { detail: unknown }).detail)
  }
  return e.message
}

const EUR0 = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const EUR2 = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Fields shared by the add/edit position forms. */
interface PositionFormValue {
  position_number: string
  description: string
  billing_rate_per_hour: number
  budget_euros: number
  overrunnable: boolean
}

/** Inline form used both for adding and editing a line item. Shows the derived
 *  hours budget (€ ÷ Satz) so the user sees the €/Std equivalence (P5). */
function PositionFields({
  value, onChange,
}: { value: PositionFormValue; onChange: (v: PositionFormValue) => void }) {
  const hours = value.billing_rate_per_hour > 0 ? value.budget_euros / value.billing_rate_per_hour : null
  return (
    <div className="flex gap-2 items-end flex-wrap">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Positionsnr.</label>
        <input required placeholder="z.B. AP1"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={value.position_number}
          onChange={(e) => onChange({ ...value, position_number: e.target.value })} />
      </div>
      <div className="flex-1 min-w-[9rem]">
        <label className="block text-xs text-gray-500 mb-1">Bezeichnung</label>
        <input placeholder="z.B. Softwareentwicklung"
          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Satz (€/Std.)</label>
        <input type="number" min={0} step={0.01} placeholder="0"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={value.billing_rate_per_hour || ''}
          onChange={(e) => onChange({ ...value, billing_rate_per_hour: parseFloat(e.target.value) || 0 })} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Budget (€){hours != null && <span className="ml-1 text-gray-400">= {hours.toFixed(1)} Std.</span>}
        </label>
        <input type="number" min={0} step={0.01} placeholder="0"
          className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={value.budget_euros || ''}
          onChange={(e) => onChange({ ...value, budget_euros: parseFloat(e.target.value) || 0 })} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5" title="Günstiger Posten: darf bei der Neuberechnung über sein Budget hinaus geplant werden (teure Posten bleiben hart begrenzt).">
        <input type="checkbox"
          checked={value.overrunnable}
          onChange={(e) => onChange({ ...value, overrunnable: e.target.checked })} />
        überschreitbar
      </label>
    </div>
  )
}

/** Line-item (Projektposten) management: budget-consistency banner (§P3), editable
 *  list, and add form defaulting to the open difference. */
function BillingPositionsSection({
  projectId, totalBudget, positions, invoiceList, positionMode,
}: {
  projectId: number
  totalBudget: number
  positions: BillingPosition[]
  invoiceList: MonthlyInvoice[]
  positionMode: boolean
}) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState<PositionFormValue | null>(null)
  const [editing, setEditing] = useState<{ id: number; value: PositionFormValue } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const onErr = (e: unknown) => setErr(e instanceof ApiError && e.status === 409
    ? (typeof e.body === 'object' && e.body && 'detail' in e.body ? String((e.body as { detail: unknown }).detail) : 'Vorgang nicht möglich.')
    : 'Fehler beim Speichern.')
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['billingPositions', projectId] })
    qc.invalidateQueries({ queryKey: ['positionMode', projectId] })
  }

  const { data: modeStatus } = useQuery({
    queryKey: ['positionMode', projectId],
    queryFn: () => projects.positionModeStatus(projectId),
  })
  const toggleMode = useMutation({
    mutationFn: (enabled: boolean) => projects.setPositionMode(projectId, enabled),
    onSuccess: () => {
      setErr(null)
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['positionMode', projectId] })
      qc.invalidateQueries({ queryKey: ['milestones-detail', projectId] })
    },
    onError: onErr,
  })

  const addMut = useMutation({
    mutationFn: (d: PositionFormValue) => projects.addBillingPosition(projectId, d),
    onSuccess: () => { setAdding(null); setErr(null); invalidate() },
    onError: onErr,
  })
  const updateMut = useMutation({
    mutationFn: (v: { id: number; value: PositionFormValue }) => projects.updateBillingPosition(projectId, v.id, v.value),
    onSuccess: () => { setEditing(null); setErr(null); invalidate() },
    onError: onErr,
  })
  const deleteMut = useMutation({
    mutationFn: (bpId: number) => projects.deleteBillingPosition(projectId, bpId),
    onSuccess: () => { setErr(null); invalidate() },
    onError: onErr,
  })

  const allocated = positions.reduce((s, p) => s + p.budget_euros, 0)
  const open = totalBudget - allocated
  const EPS = 1e-6
  const isOver = allocated > totalBudget + EPS
  const isComplete = Math.abs(open) <= EPS
  const startAdd = () => setAdding({ position_number: '', description: '', billing_rate_per_hour: 0, budget_euros: Math.max(0, open), overrunnable: false })

  return (
    <div className="mt-8 pt-6 border-t border-gray-200">
      <h4 className="text-sm font-medium text-gray-700 mb-1">Projektposten (Vertragspositionen)</h4>
      <p className="text-xs text-gray-400 mb-3">
        Vertragspositionen mit eigenem Satz und Budget. Für einfache Projekte genügt eine Position;
        die Summe der Posten-Budgets muss dem Projektbudget entsprechen.
      </p>

      {/* Budget-consistency banner (§P3) */}
      <div className={`mb-3 text-xs rounded px-3 py-2 border ${
        isOver ? 'bg-red-50 border-red-200 text-red-700'
        : isComplete ? 'bg-green-50 border-green-200 text-green-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
        {positions.length === 0
          ? <>Noch keine Posten. Gesamtbudget {EUR0(totalBudget)} ist unverteilt.</>
          : isOver
          ? <>Σ Posten-Budget {EUR2(allocated)} überschreitet das Gesamtbudget {EUR2(totalBudget)} um {EUR2(-open)}.</>
          : isComplete
          ? <>Vollständig verteilt: Σ {EUR2(allocated)} = Gesamtbudget.</>
          : <>Verteilt {EUR2(allocated)} von {EUR2(totalBudget)} — offen: <strong>{EUR2(open)}</strong>. Abschließend muss alles verteilt sein.</>}
      </div>

      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      {/* Existing positions */}
      {positions.length > 0 && (
        <div className="mb-3 bg-white rounded border border-gray-200 divide-y divide-gray-100">
          {positions.map((bp) => {
            const inUse = invoiceList.some((inv) => inv.billing_position_id === bp.id)
            if (editing?.id === bp.id) {
              return (
                <div key={bp.id} className="px-3 py-2.5 bg-blue-50/40">
                  <PositionFields value={editing.value} onChange={(v) => setEditing({ id: bp.id, value: v })} />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => updateMut.mutate(editing)} disabled={updateMut.isPending}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Speichern</button>
                    <button onClick={() => { setEditing(null); setErr(null) }}
                      className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
                  </div>
                </div>
              )
            }
            const hours = bp.billing_rate_per_hour > 0 ? bp.budget_euros / bp.billing_rate_per_hour : null
            return (
              <div key={bp.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-700">{bp.position_number}</span>
                  {bp.description && <><span className="mx-1.5 text-gray-300">·</span><span className="text-gray-600">{bp.description}</span></>}
                  {bp.overrunnable && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700"
                      title="Überschreitbar: darf bei der Neuberechnung über sein Budget hinaus geplant werden.">
                      überschreitbar
                    </span>
                  )}
                  <span className="ml-2 text-xs text-gray-400">
                    {EUR2(bp.budget_euros)}
                    {bp.billing_rate_per_hour > 0 && <> · {EUR2(bp.billing_rate_per_hour)}/Std.{hours != null && <> · {hours.toFixed(1)} Std.</>}</>}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => { setAdding(null); setErr(null); setEditing({ id: bp.id, value: { position_number: bp.position_number, description: bp.description, billing_rate_per_hour: bp.billing_rate_per_hour, budget_euros: bp.budget_euros, overrunnable: bp.overrunnable } }) }}
                    title="Bearbeiten"
                    className="p-1 text-gray-300 hover:text-blue-500 transition-colors"><Pencil size={13} /></button>
                  <button
                    onClick={() => deleteMut.mutate(bp.id)}
                    disabled={inUse || deleteMut.isPending}
                    title={inUse ? 'Wird von einer Abrechnung verwendet — kann nicht gelöscht werden' : 'Löschen'}
                    className="p-1 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><Trash2 size={13} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add new position */}
      {adding ? (
        <div className="bg-blue-50/40 rounded border border-blue-100 px-3 py-2.5">
          <PositionFields value={adding} onChange={setAdding} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => addMut.mutate(adding)} disabled={addMut.isPending || !adding.position_number.trim()}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Hinzufügen</button>
            <button onClick={() => { setAdding(null); setErr(null) }}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
          </div>
        </div>
      ) : (
        <button onClick={startAdd} disabled={isComplete}
          title={isComplete ? 'Budget ist bereits vollständig verteilt' : 'Neuen Posten anlegen'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
          <Plus size={13} /> Posten hinzufügen
        </button>
      )}

      {/* Position-mode toggle (§21 WP8) */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-700">Posten-Modus</p>
            <p className="text-xs text-gray-400 max-w-md">
              Aktiviert die Verteilung, Zuweisung, Import-Zuordnung und Abrechnung je Posten.
              Voraussetzung: alle aktiven Mitglieder einem Posten zugewiesen und Budget vollständig verteilt.
            </p>
          </div>
          <button
            onClick={() => toggleMode.mutate(!positionMode)}
            disabled={toggleMode.isPending || (!positionMode && modeStatus != null && !modeStatus.can_enable)}
            title={!positionMode && modeStatus?.reasons.length ? modeStatus.reasons.join('\n') : undefined}
            className={`shrink-0 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              positionMode ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {positionMode ? 'Posten-Modus aktiv — deaktivieren' : 'Posten-Modus aktivieren'}
          </button>
        </div>
        {!positionMode && modeStatus != null && !modeStatus.can_enable && modeStatus.reasons.length > 0 && (
          <ul className="mt-2 list-disc list-inside text-[11px] text-amber-600 space-y-0.5">
            {modeStatus.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Line-item picker for the member forms (§21 P2). Rendered only when the project has
 *  positions; selecting a priced position makes the member's rate come from that position. */
function PositionSelect({
  positions, value, onChange, required,
}: {
  positions: BillingPosition[]
  value: number | null
  onChange: (v: number | null) => void
  required?: boolean
}) {
  if (positions.length === 0) return null
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        Posten <span className="text-gray-400 font-normal">(Satz kommt vom Posten)</span>
      </label>
      <select required={required} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : null)}>
        <option value="">— kein Posten —</option>
        {positions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.position_number}{p.description ? ` – ${p.description}` : ''}{p.billing_rate_per_hour > 0 ? ` (${p.billing_rate_per_hour} €/Std.)` : ''}
          </option>
        ))}
      </select>
    </div>
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

interface AssignRow {
  key: string
  membershipId: number | null
  billing_position_id: number | null
  weekly_capacity_hours: number
  priority: number
  billing_rate_per_hour: number
  vacation_days_taken: number
}

/** Manage ALL Posten-assignments of one MA in a project as an editable list — each row is
 *  one ProjectMembership. Saving diffs against the existing memberships (create/update/delete).
 *  Shared Von/Bis apply to every row (the common case; date ranges per Posten are rare). */
function MemberAssignmentsModal({
  projectId, person, memberships, positions, positionMode, onClose, onSaved,
}: {
  projectId: number
  person: { id: number; name: string }
  memberships: ProjectMembership[]
  positions: BillingPosition[]
  positionMode: boolean
  onClose: () => void
  onSaved: (warnings: string[]) => void
}) {
  const mine = memberships.filter((m) => m.person_id === person.id)
  const posById = new Map(positions.map((p) => [p.id, p]))
  const seq = useRef(0)
  const [fromDate, setFromDate] = useState(mine[0]?.from_date ?? '')
  const [toDate, setToDate] = useState(mine[0]?.to_date ?? '')
  const [rows, setRows] = useState<AssignRow[]>(
    mine.map((m) => ({
      key: 'm' + m.id, membershipId: m.id, billing_position_id: m.billing_position_id,
      weekly_capacity_hours: m.weekly_capacity_hours, priority: m.priority,
      billing_rate_per_hour: m.billing_rate_per_hour, vacation_days_taken: m.vacation_days_taken,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const rowRate = (r: AssignRow) => {
    const p = r.billing_position_id != null ? posById.get(r.billing_position_id) : undefined
    return p && p.billing_rate_per_hour > 0 ? p.billing_rate_per_hour : r.billing_rate_per_hour
  }
  const setRow = (key: string, patch: Partial<AssignRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const addRow = () => {
    const used = new Set(rows.map((r) => r.billing_position_id))
    const free = positions.find((p) => !used.has(p.id))
    setRows((rs) => [...rs, {
      key: 'n' + (seq.current++), membershipId: null,
      billing_position_id: free?.id ?? null, weekly_capacity_hours: 0, priority: 0,
      billing_rate_per_hour: 0, vacation_days_taken: 0,
    }])
  }

  const save = async () => {
    setErr(null)
    if (!fromDate || !toDate) return setErr('Von und Bis sind erforderlich.')
    if (rows.length === 0) return setErr('Mindestens eine Zuweisung erforderlich.')
    if (positionMode && rows.some((r) => r.billing_position_id == null))
      return setErr('Im Posten-Modus muss jede Zeile einen Posten haben.')
    const posIds = rows.map((r) => r.billing_position_id)
    if (new Set(posIds).size !== posIds.length)
      return setErr('Jeder Posten darf diesem MA nur einmal zugewiesen sein.')
    if (rows.some((r) => !(r.weekly_capacity_hours > 0)))
      return setErr('h/Woche muss größer als 0 sein.')
    setSaving(true)
    try {
      const keptIds = new Set(rows.filter((r) => r.membershipId != null).map((r) => r.membershipId!))
      for (const m of mine) if (!keptIds.has(m.id)) await projects.deleteMembership(projectId, m.id)
      const warnings: string[] = []
      for (const r of rows) {
        const payload = {
          from_date: fromDate, to_date: toDate, weekly_capacity_hours: r.weekly_capacity_hours,
          billing_rate_per_hour: rowRate(r), priority: r.priority,
          vacation_days_taken: r.vacation_days_taken, billing_position_id: r.billing_position_id,
        }
        const res = r.membershipId != null
          ? await projects.updateMembership(projectId, r.membershipId, payload)
          : await projects.addMembership(projectId, { person_id: person.id, ...payload })
        if (res.warnings) warnings.push(...res.warnings)
      }
      onSaved(warnings)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Posten-Zuweisungen — ${person.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Von</label>
            <input type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bis</label>
            <input type="date" className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
              value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-gray-500">Zeitraum gilt für alle Posten-Zuweisungen dieses MA.</p>

        <div className="border border-gray-200 rounded overflow-hidden">
          <div className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2 px-2 py-1.5 bg-gray-50 text-[11px] font-medium text-gray-500">
            <span>Posten</span><span>h/Woche</span><span>Priorität</span><span></span>
          </div>
          {rows.length === 0 && (
            <div className="px-2 py-3 text-xs text-gray-400">Noch keine Zuweisung — „+ Posten" klicken.</div>
          )}
          {rows.map((r) => {
            const pos = r.billing_position_id != null ? posById.get(r.billing_position_id) : undefined
            const rateFromPos = pos != null && pos.billing_rate_per_hour > 0
            return (
              <div key={r.key} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2 px-2 py-1.5 items-center border-t border-gray-100">
                <div>
                  <select className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                    value={r.billing_position_id ?? ''}
                    onChange={(e) => setRow(r.key, { billing_position_id: e.target.value === '' ? null : parseInt(e.target.value) })}>
                    {!positionMode && <option value="">— kein Posten —</option>}
                    {positions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.position_number}{p.description ? ` – ${p.description}` : ''}{p.billing_rate_per_hour > 0 ? ` (${p.billing_rate_per_hour} €)` : ''}
                      </option>
                    ))}
                  </select>
                  {!rateFromPos && (
                    <input type="number" min={0} step={0.01} placeholder="Satz €/Std."
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      value={r.billing_rate_per_hour || ''}
                      onChange={(e) => setRow(r.key, { billing_rate_per_hour: parseFloat(e.target.value) || 0 })} />
                  )}
                </div>
                <input type="number" min={0} step={0.01}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  value={r.weekly_capacity_hours || ''}
                  onChange={(e) => setRow(r.key, { weekly_capacity_hours: parseFloat(e.target.value) || 0 })} />
                <input type="number" step={1}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                  value={r.priority}
                  onChange={(e) => setRow(r.key, { priority: parseInt(e.target.value) || 0 })} />
                <button type="button" title="Zuweisung entfernen"
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  <Trash2 size={14} />
                </button>
              </div>
            )
          })}
        </div>
        <button type="button" onClick={addRow}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
          <Plus size={14} /> Posten
        </button>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

type Tab = 'milestones' | 'invoices' | 'members' | 'bookings' | 'settings'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = parseInt(id!)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('milestones')
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [editMember, setEditMember] = useState<ProjectMembership | null>(null)
  const [editMemberForm, setEditMemberForm] = useState({ from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90, priority: 0, vacation_days_taken: 0, billing_position_id: null as number | null })
  const [editAssign, setEditAssign] = useState<{ personId: number; personName: string } | null>(null)  // Posten-Zuweisungs-Liste eines MA
  const [confirmReopenId, setConfirmReopenId] = useState<number | null>(null)
  const [confirmReopenMilestone, setConfirmReopenMilestone] = useState<{ year: number; month: number } | null>(null)
  const [expandedMilestones, setExpandedMilestones] = useState<Set<number>>(new Set())
  const [editBudget, setEditBudget] = useState<{ milestoneId: number; budgetId: number; personName: string; currentHours: number } | null>(null)
  const [editHours, setEditHours] = useState(0)
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([])   // manual-edit warnings (V6)
  const [budgetNeedsConfirm, setBudgetNeedsConfirm] = useState(false)  // budget overrun awaiting confirm
  const [editTarget, setEditTarget] = useState<{ milestoneId: number; year: number; month: number } | null>(null)  // edit monthly € target
  const [editTargetAmount, setEditTargetAmount] = useState(0)
  const [targetWarnings, setTargetWarnings] = useState<string[]>([])
  const [editAbsence, setEditAbsence] = useState<{ milestoneId: number; budgetId: number; personName: string } | null>(null)  // edit estimated absence
  const [editAbsenceDays, setEditAbsenceDays] = useState(0)
  const [closeForm, setCloseForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, billing_position_id: 0 })
  const [addMemberForm, setAddMemberForm] = useState({ person_id: 0, from_date: '', to_date: '', weekly_capacity_hours: 40, billing_rate_per_hour: 90, priority: 0, vacation_days_taken: 0, billing_position_id: null as number | null })
  const [error, setError] = useState<string | null>(null)
  const [memberWarnings, setMemberWarnings] = useState<string[]>([])
  const [closeWarnings, setCloseWarnings] = useState<string[]>([])
  const [pendingCloseForm, setPendingCloseForm] = useState<typeof closeForm | null>(null)
  const [showReinitConfirm, setShowReinitConfirm] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Omit<Project, 'id' | 'position_mode'> | null>(null)
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
  const { data: suggestions = [] } = useQuery({ queryKey: ['recalc-preview', projectId], queryFn: () => projects.recalcPreview(projectId) })
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
    qc.invalidateQueries({ queryKey: ['recalc-preview', projectId] })
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
    mutationFn: ({ milestoneId, budgetId, hours, confirm }: { milestoneId: number; budgetId: number; hours: number; confirm?: boolean }) =>
      projects.updatePersonBudget(projectId, milestoneId, budgetId, hours, confirm),
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
  const clearTarget = useMutation({
    mutationFn: (milestoneId: number) => projects.clearMilestoneTargetBudget(projectId, milestoneId),
    onSuccess: () => { invalidateMilestones(); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const toggleHoursLock = useMutation({
    mutationFn: ({ milestoneId, budgetId, locked }: { milestoneId: number; budgetId: number; locked: boolean }) =>
      projects.setHoursLock(projectId, milestoneId, budgetId, locked),
    onSuccess: () => { invalidateMilestones(); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const setEstAbsence = useMutation({
    mutationFn: ({ milestoneId, budgetId, days }: { milestoneId: number; budgetId: number; days: number | null }) =>
      projects.setEstimatedAbsence(projectId, milestoneId, budgetId, days),
    onSuccess: () => { invalidateMilestones(); setEditAbsence(null); setError(null) },
    onError: (e: Error) => setError(e.message),
  })
  const planningLock = useMutation({
    mutationFn: ({ milestoneId, locked }: { milestoneId: number; locked: boolean }) =>
      projects.setPlanningLock(projectId, milestoneId, locked),
    onSuccess: invalidateMilestones,
    onError: (e: Error) => setError(e.message),
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
    onError: (e: Error) => setError(errText(e)),
  })
  const updateMember = useMutation({
    mutationFn: () => projects.updateMembership(projectId, editMember!.id, editMemberForm),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['memberships', projectId] })
      setEditMember(null)
      setError(null)
      if (result.warnings && result.warnings.length > 0) setMemberWarnings(result.warnings)
    },
    onError: (e: Error) => setError(errText(e)),
  })
  const removeMember = useMutation({
    mutationFn: (mid: number) => projects.deleteMembership(projectId, mid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memberships', projectId] }),
  })

  const updateProject = useMutation({
    mutationFn: (data: Omit<Project, 'id' | 'position_mode'>) => projects.update(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!project) return <div className="p-6 text-sm text-gray-400">Lade…</div>

  // Position mode (§21 WP8): the project's explicit opt-in flag is the single trigger.
  const posById = new Map(billingPositions.map((p) => [p.id, p]))
  const positionMode = project.position_mode
  const memberRate = (m: ProjectMembership) =>
    m.billing_position_id != null ? (posById.get(m.billing_position_id)?.billing_rate_per_hour ?? m.billing_rate_per_hour) : m.billing_rate_per_hour

  const tabs: { id: Tab; label: string }[] = [
    { id: 'milestones', label: 'Meilensteine' },
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
          // Invoiced Ist per closed month, summed over ALL invoices of that month (position
          // mode has one invoice per line item, §21 WP6 — so aggregate, don't take one).
          const invoiceByMonth = new Map<string, { hours: number; euros: number }>()
          for (const i of invoiceList) {
            const k = `${i.year}-${i.month}`
            const e = invoiceByMonth.get(k) ?? { hours: 0, euros: 0 }
            e.hours += i.total_hours; e.euros += i.total_amount_euros
            invoiceByMonth.set(k, e)
          }
          const plannedCost = (d: MilestoneDetail) => d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0)
          // Budget-relevant € of a month: locked → invoiced Ist, open → planned current cost.
          // Summed this is the forecast (Prognose), which never exceeds the budget.
          const monthEuros = (d: MilestoneDetail) => {
            const inv = invoiceByMonth.get(`${d.milestone.year}-${d.milestone.month}`)
            return d.milestone.is_locked && inv != null ? inv.euros : plannedCost(d)
          }
          // Budget-relevant hours (forecast): closed → invoiced Ist hours, open → planned.
          // Summed this reconciles with the € Prognose ÷ Satz (unlike Σ plan of all months,
          // whose closed part uses the frozen plan, not the Ist).
          const monthHours = (d: MilestoneDetail) => {
            const inv = invoiceByMonth.get(`${d.milestone.year}-${d.milestone.month}`)
            return d.milestone.is_locked && inv != null ? inv.hours : d.milestone.current_hours
          }
          const totals = milestonesDetail.reduce(
            (acc, d: MilestoneDetail) => ({
              forecastHours: acc.forecastHours + monthHours(d),
              booked: acc.booked + d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0),
              forecastEuros: acc.forecastEuros + monthEuros(d),
            }),
            { forecastHours: 0, booked: 0, forecastEuros: 0 },
          )
          const istEuros = invoiceList.reduce((s, i) => s + i.total_amount_euros, 0)  // abgerechnet
          const budget = project.total_budget_euros
          const deltaEuros = totals.forecastEuros - budget  // >0 = Überschreitung, <0 = Rest
          const overBudget = deltaEuros > 0.01
          // Per-member breakdown across all months: hours (Ziel/Ist) + day totals (AT/FT/Abw).
          const perMember = new Map<number, { name: string; fc: number; ist: number; at: number; ft: number; abwG: number; abwE: number; vac: number; sick: number; train: number }>()
          for (const d of milestonesDetail) {
            for (const p of d.persons) {
              const e = perMember.get(p.person_id) ?? { name: p.person_name, fc: 0, ist: 0, at: 0, ft: 0, abwG: 0, abwE: 0, vac: 0, sick: 0, train: 0 }
              // Forecast hours per member on the same basis as the total: closed → Ist (booked), open → plan.
              e.fc += d.milestone.is_locked ? (p.booked_hours ?? 0) : p.current_hours
              e.ist += p.booked_hours ?? 0
              e.at += p.work_days
              e.ft += p.holiday_days
              e.abwG += p.absence_days
              e.abwE += p.estimated_absence_days ?? 0
              e.vac += p.vacation_estimate_days ?? 0
              e.sick += p.sick_estimate_days ?? 0
              e.train += p.training_estimate_days ?? 0
              perMember.set(p.person_id, e)
            }
          }
          const memberBreakdown = [...perMember.values()].filter((e) => e.fc > 0 || e.ist > 0)
          const daysBreakdown = [...perMember.values()].filter((e) => e.at || e.ft || e.abwG || e.abwE)
          // Per-position forecast breakdown (§21 WP7): group members by their line item;
          // forecast € uses the effective (position) rate already carried per person.
          type PosMember = { name: string; hours: number; euros: number; istHours: number; istEuros: number }
          type PosAgg = { hours: number; euros: number; istHours: number; istEuros: number; members: Map<number, PosMember> }
          const perPosition = new Map<number | null, PosAgg>()
          for (const d of milestonesDetail) {
            for (const p of d.persons) {
              const key = p.billing_position_id ?? null
              const fcH = d.milestone.is_locked ? (p.booked_hours ?? 0) : p.current_hours
              const fcE = fcH * p.billing_rate_per_hour
              const istH = p.booked_hours ?? 0          // Ist = actually booked hours
              const istE = istH * p.billing_rate_per_hour
              const agg = perPosition.get(key) ?? { hours: 0, euros: 0, istHours: 0, istEuros: 0, members: new Map() }
              agg.hours += fcH; agg.euros += fcE; agg.istHours += istH; agg.istEuros += istE
              const mem = agg.members.get(p.person_id) ?? { name: p.person_name, hours: 0, euros: 0, istHours: 0, istEuros: 0 }
              mem.hours += fcH; mem.euros += fcE; mem.istHours += istH; mem.istEuros += istE
              agg.members.set(p.person_id, mem)
              perPosition.set(key, agg)
            }
          }
          const suggestionByMs = new Map(suggestions.map((s) => [s.milestone_id, s]))
          const rateByPid = new Map(memberships.map((m) => [m.person_id, m.billing_rate_per_hour]))
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
                    <span title="Mitglieder wurden nach der letzten Berechnung geändert. „Neu berechnen“ gleicht die offenen Meilensteine an (gesperrte Werte/Monate bleiben erhalten)."
                      className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      veraltet
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {milestonesDetail.length > 0 && (
                    <button onClick={() => resyncMilestones.mutate()}
                      title="Offene Meilensteine neu berechnen: Mitglieder angleichen und Budget verteilen. Gesperrte Werte/Monate und manuelle Anpassungen bleiben erhalten."
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                      <RotateCcw size={14} /> Neu berechnen
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
                      // Soll € = planned cost (Σ current×rate) — consistent with the Aufwand column
                      // (Soll above, Ist/booked in the bar) for open AND closed months. An explicit
                      // €-target on an open month is shown as the Soll instead.
                      const sollEuros = (!ms.is_locked && ms.target_budget_euros != null) ? ms.target_budget_euros : plannedEuros
                      const bookedEuros = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0) * p.billing_rate_per_hour, 0)
                      const totalBooked = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0)
                      const pct = ms.current_hours > 0 ? Math.min(150, (totalBooked / ms.current_hours) * 100) : 0
                      const barColor = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const eurPct = sollEuros > 0 ? Math.min(150, (bookedEuros / sollEuros) * 100) : 0
                      const eurBarColor = eurPct > 100 ? 'bg-red-500' : eurPct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      const sug = suggestionByMs.get(ms.id)
                      const rebalDelta = sug ? sug.suggested_total_hours - ms.current_hours : 0
                      // Keyed by budget_id (WP5): a person may have several rows (one per Posten).
                      const sugByBudget = sug ? new Map(sug.budgets.map((b) => [b.budget_id, b.suggested_hours])) : null
                      const rebalSuggestedEuros = sug ? sug.budgets.reduce((s, b) => s + b.suggested_hours * (rateByPid.get(b.person_id) ?? 0), 0) : 0
                      const rebalDeltaEuros = sug ? rebalSuggestedEuros - plannedEuros : 0
                      const showRebal = sug && !ms.is_locked && !ms.is_planning_locked && Math.abs(rebalDelta) > 0.1
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
                              {showRebal && (
                                <div className="mt-1 text-[11px] text-indigo-600" title="Vorschlag aus „Neu berechnen“ (Budget-Ausschöpfung). Über den Button oben anwenden.">
                                  → {fmtH(sug!.suggested_total_hours)} ({rebalDelta > 0 ? '+' : ''}{rebalDelta.toFixed(2)})
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="min-w-[9rem]">
                              <div className="flex justify-end items-center gap-1 text-xs text-gray-500 mb-1">
                                <span>{sollEuros > 0 ? fmtEur(sollEuros) : '–'}</span>
                                <span className="text-[10px] text-gray-400">(Soll)</span>
                                {!ms.is_locked && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditTarget({ milestoneId: ms.id, year: ms.year, month: ms.month }); setEditTargetAmount(Math.round(sollEuros * 100) / 100); setTargetWarnings([]) }}
                                    title="Budget-Ziel dieses Monats setzen (verteilt die Stunden automatisch)"
                                    className="p-0.5 text-gray-400 hover:text-blue-600">
                                    <Pencil size={11} />
                                  </button>
                                )}
                                {!ms.is_locked && ms.target_budget_euros != null && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); clearTarget.mutate(ms.id) }}
                                    title="Budget-Ziel gesperrt (Sync mit externem System) — klicken zum Entsperren; Neuberechnung darf den Monat dann wieder anpassen"
                                    className="p-0.5 text-blue-500 hover:text-blue-700">
                                    <Lock size={11} />
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
                              {showRebal && Math.abs(rebalDeltaEuros) > 0.5 && (
                                <div className="mt-1 text-[11px] text-indigo-600" title="Budget-Ausschöpfung nach „Neu berechnen“.">
                                  → {fmtEur(rebalSuggestedEuros)} ({rebalDeltaEuros > 0 ? '+' : ''}{fmtEur(rebalDeltaEuros)})
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col items-start gap-1">
                              {(() => {
                                const label = ms.is_locked ? 'Abgeschlossen' : ms.is_planning_locked ? 'Gesperrt' : 'Offen'
                                const cls = ms.is_locked ? 'bg-gray-100 text-gray-500' : ms.is_planning_locked ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'
                                const Icon = ms.is_locked || ms.is_planning_locked ? Lock : Unlock
                                return (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                                    <Icon size={11} className={label === 'Offen' ? 'text-green-600' : undefined} />
                                    {label}
                                  </span>
                                )
                              })()}
                              {ms.status === 'open' && !ms.is_locked && (
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => planningLock.mutate({ milestoneId: ms.id, locked: !ms.is_planning_locked })}
                                    title={ms.is_planning_locked ? 'Planung gesperrt — „Neu berechnen“ lässt den Monat unangetastet. Klicken zum Entsperren.' : 'Monat für die Planung sperren — „Neu berechnen“ ändert ihn dann nicht mehr.'}
                                    className="text-xs text-purple-600 hover:underline whitespace-nowrap">
                                    {ms.is_planning_locked ? 'Entsperren' : 'Sperren'}
                                  </button>
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
                                </div>
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
                                    <th className="px-4 py-1.5 text-left font-normal" title="Arbeitstage (AT, Mo–Fr exkl. Feiertage) · Feiertage (FT) · geplante Abwesenheit (Abw. gepl., aus Abwesenheits-Einträgen) · geschätzte Abwesenheit (Abw. gesch., Resturlaub anteilig + pauschal Krank/Fortbildung abzüglich bereits eingetragener Tage)">Tage (AT · FT · Abw. gepl./gesch.)</th>
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
                                    const absOverride = p.estimated_absence_days_override
                                    // Per-member rebalance hint (share of the "Neu berechnen" preview for this person).
                                    const pSug = sugByBudget ? sugByBudget.get(p.budget_id) : undefined
                                    const pRebalDelta = pSug != null ? pSug - cur : 0
                                    const showPRebal = showRebal && pSug != null && Math.abs(pRebalDelta) > 0.1
                                    // PWS gauge: target vs effective (Ist) as vertical markers, delta as a segment.
                                    const pwsMax = Math.max(targetPws ?? 0, effPws ?? 0, 1) * 1.15
                                    const tPos = targetPws !== null ? Math.min(100, targetPws / pwsMax * 100) : null
                                    const iPos = effPws !== null ? Math.min(100, effPws / pwsMax * 100) : null
                                    const deltaColor = deltaPws === null ? '' : deltaPws > 0.05 ? 'text-orange-600' : deltaPws < -0.05 ? 'text-blue-600' : 'text-green-600'
                                    return (
                                    <tr key={p.budget_id} className="text-sm border-b border-slate-100 last:border-0">
                                      <td className="pl-12 pr-4 py-2 text-gray-700 whitespace-nowrap">
                                        {p.person_name}
                                        {p.billing_position_id != null && (
                                          <span className="ml-1.5 text-[11px] text-gray-400">
                                            ({posById.get(p.billing_position_id)?.position_number ?? '?'})
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                                        {avail !== null ? fmtH(avail) : <span className="text-gray-300">–</span>}
                                        {showPRebal && (
                                          <div className="text-[11px] text-indigo-600" title="Vorschlag aus „Neu berechnen“ für diese Person.">
                                            → {fmtH(pSug!)} ({pRebalDelta > 0 ? '+' : ''}{pRebalDelta.toFixed(2)})
                                          </div>
                                        )}
                                        {p.cap_reason && (
                                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600 whitespace-normal max-w-[12rem]" title={p.cap_reason}>
                                            <AlertTriangle size={11} className="shrink-0" />
                                            <span>{p.cap_reason}</span>
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        <div className="min-w-[11rem]">
                                          <div className="flex justify-end items-center gap-1 text-[11px] text-gray-500 mb-1">
                                            <span>{fmtH(cur)} <span className="text-[10px] text-gray-400">(Soll)</span></span>
                                            {editable && (
                                              <button
                                                onClick={() => { setEditBudget({ milestoneId: ms.id, budgetId: p.budget_id, personName: p.person_name, currentHours: p.current_hours }); setEditHours(p.current_hours) }}
                                                title="Soll-Stunden dieser Person anpassen"
                                                className="p-0.5 text-gray-400 hover:text-blue-600">
                                                <Pencil size={11} />
                                              </button>
                                            )}
                                            {editable && (
                                              <button
                                                onClick={() => toggleHoursLock.mutate({ milestoneId: ms.id, budgetId: p.budget_id, locked: !p.is_manual_override })}
                                                title={p.is_manual_override ? 'Stunden gesperrt — bleiben bei Neuberechnung erhalten. Klicken zum Entsperren.' : 'Stunden entsperrt — Neuberechnung darf anpassen. Klicken zum Sperren.'}
                                                className={`p-0.5 ${p.is_manual_override ? 'text-purple-500 hover:text-purple-700' : 'text-gray-300 hover:text-gray-500'}`}>
                                                {p.is_manual_override ? <Lock size={11} /> : <Unlock size={11} />}
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
                                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap" title={`Arbeitstage ${p.work_days} · Feiertage ${p.holiday_days} · Abw. geplant ${p.absence_days} (aus Abwesenheits-Einträgen)\nAbw. geschätzt ${estAbs.toFixed(1)}${absOverride != null ? ' — manuell gesetzt/gesperrt' : `:\n  · Resturlaub ${p.vacation_estimate_days.toFixed(1)}\n  · Fortbildung ${p.training_estimate_days.toFixed(1)}\n  · Krankheit ${p.sick_estimate_days.toFixed(1)}`}`}>
                                        <span className="inline-flex items-center gap-1">
                                          <span>{p.work_days} · {p.holiday_days} · {p.absence_days} · </span>
                                          <span className={absOverride != null ? 'text-purple-600 font-medium' : 'text-gray-400'}>
                                            {absOverride != null ? '' : '~'}{estAbs.toFixed(1)}
                                          </span>
                                          {editable && (
                                            <button
                                              onClick={() => { setEditAbsence({ milestoneId: ms.id, budgetId: p.budget_id, personName: p.person_name }); setEditAbsenceDays(Math.round(estAbs * 10) / 10) }}
                                              title="Geschätzte Abwesenheit (Tage) manuell setzen"
                                              className="p-0.5 text-gray-400 hover:text-blue-600">
                                              <Pencil size={11} />
                                            </button>
                                          )}
                                          {editable && absOverride != null && (
                                            <button
                                              onClick={() => setEstAbsence.mutate({ milestoneId: ms.id, budgetId: p.budget_id, days: null })}
                                              title="Geschätzte Abwesenheit gesperrt (manuell) — klicken zum Entsperren (zurück auf automatische Schätzung)"
                                              className="p-0.5 text-purple-500 hover:text-purple-700">
                                              <Lock size={11} />
                                            </button>
                                          )}
                                        </span>
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
                        {/* F2: forecast hours (closed=Ist, open=Plan) + per-member Ist/Ziel breakdown */}
                        <td className="px-4 py-3 text-gray-700">
                          <div title="Prognose-Stunden: abgeschlossene Monate mit Ist, offene mit Plan (rekonziliert mit der €-Prognose ÷ Satz).">{fmtH(totals.forecastHours)}</div>
                          <div className="text-xs font-normal text-gray-400">
                            gebucht {fmtH(totals.booked)}
                          </div>
                          {memberBreakdown.length > 0 && (
                            <div className="mt-1.5 space-y-0.5 font-normal">
                              {memberBreakdown.map((e) => (
                                <div key={e.name} className="text-[11px] text-gray-500 whitespace-nowrap"
                                  title="gebucht (Ist) / Prognose (abgeschlossene Monate = Ist, offene = Plan). Die Prognose-Werte summieren sich zum Gesamt oben.">
                                  {e.name}: <span className="text-gray-600">{e.ist.toFixed(2)}</span> / {e.fc.toFixed(2)} h
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
                        {/* Control view: per-member day totals aggregated over all milestones (AT · FT · Abw. gepl./gesch.) */}
                        <td className="px-4 py-3 align-top">
                          {daysBreakdown.length > 0 && (
                            <div className="space-y-0.5 font-normal">
                              <div className="text-[10px] uppercase text-gray-400 tracking-wide">Tage gesamt (AT·FT·Abw.)</div>
                              {daysBreakdown.map((e) => (
                                <div key={e.name} className="text-[11px] text-gray-500 whitespace-nowrap"
                                  title={`${e.name} (Summe über alle Meilensteine):\nArbeitstage ${e.at} · Feiertage ${e.ft} · Abw. geplant ${e.abwG}\nAbw. geschätzt ${e.abwE.toFixed(1)}:\n  · Resturlaub ${e.vac.toFixed(1)}\n  · Fortbildung ${e.train.toFixed(1)}\n  · Krankheit ${e.sick.toFixed(1)}`}>
                                  {e.name}: {e.at} · {e.ft} · {e.abwG} · <span className="text-gray-400">~{e.abwE.toFixed(1)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Aufschlüsselung nach Posten (§21 WP7) — only in position mode */}
              {positionMode && perPosition.size > 0 && (
                <div className="mt-4 bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700 flex items-center justify-between">
                    <span>Aufwand nach Posten <span className="font-normal text-gray-400">(aufklappen für Mitarbeiter)</span></span>
                    <span className="flex items-center gap-4 text-[10px] uppercase tracking-wide text-gray-400 font-normal">
                      <span className="w-24 text-right">Ist (Std.)</span>
                      <span className="w-28 text-right">Ist (€)</span>
                      <span className="w-24 text-right">Prognose (Std.)</span>
                      <span className="w-28 text-right">Prognose (€)</span>
                      <span className="w-32 text-right">Rest (€)</span>
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {[...perPosition.entries()]
                      .sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
                      .map(([posId, agg]) => {
                        const pos = posId != null ? posById.get(posId) : undefined
                        const label = pos ? `${pos.position_number}${pos.description ? ` – ${pos.description}` : ''}` : '⚠ ohne Posten'
                        const posBudget = pos?.budget_euros ?? 0
                        const rest = posBudget - agg.euros
                        return (
                          <details key={posId ?? 'none'} className="group">
                            <summary className="flex items-center justify-between px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50 list-none">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <ChevronRight size={13} className="text-gray-400 group-open:rotate-90 transition-transform shrink-0" />
                                <span className={pos ? 'font-medium text-gray-700 truncate' : 'font-medium text-red-500 truncate'}>{label}</span>
                              </span>
                              <span className="flex items-center gap-4 text-xs shrink-0">
                                <span className="w-24 text-right text-gray-500">{fmtH(agg.istHours)}</span>
                                <span className="w-28 text-right text-gray-500">{fmtEur(agg.istEuros)}</span>
                                <span className="w-24 text-right text-gray-500">{fmtH(agg.hours)}</span>
                                <span className="w-28 text-right text-gray-700 font-medium">{fmtEur(agg.euros)}</span>
                                <span className={`w-32 text-right ${rest < -0.01 ? 'text-red-600' : 'text-gray-400'}`}
                                  title="Posten-Budget − Prognose">
                                  {pos ? fmtEur(rest) : '—'}
                                </span>
                              </span>
                            </summary>
                            <div className="px-4 pb-2.5 pl-9 space-y-0.5">
                              {[...agg.members.values()].filter((m) => m.hours > 0.001 || m.istHours > 0.001).map((m) => (
                                <div key={m.name} className="flex items-center justify-between text-[11px] text-gray-500">
                                  <span className="truncate">{m.name}</span>
                                  <span className="flex items-center gap-4 shrink-0">
                                    <span className="w-24 text-right">{fmtH(m.istHours)}</span>
                                    <span className="w-28 text-right">{fmtEur(m.istEuros)}</span>
                                    <span className="w-24 text-right">{fmtH(m.hours)}</span>
                                    <span className="w-28 text-right">{fmtEur(m.euros)}</span>
                                    <span className="w-32" />
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Invoices ── */}
        {tab === 'invoices' && (() => {
          const MONTH_FULL = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
          const totalInvoiced = invoiceList.reduce((s, inv) => s + inv.total_amount_euros, 0)
          const totalHoursInvoiced = invoiceList.reduce((s, inv) => s + inv.total_hours, 0)
          const rest = project.total_budget_euros - totalInvoiced
          const lastInv = [...invoiceList].sort((a, b) => a.year !== b.year ? b.year - a.year : b.month - a.month)[0]
          const fmt = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const posLabel = (id: number) => {
            const p = posById.get(id)
            return p ? `${p.position_number}${p.description ? ` – ${p.description}` : ''}` : `#${id}`
          }
          const lastMonthInvoices = lastInv
            ? invoiceList.filter((i) => i.year === lastInv.year && i.month === lastInv.month)
            : []
          const lastMonthAmount = lastMonthInvoices.reduce((s, i) => s + i.total_amount_euros, 0)
          // Invoiced totals per line item (position mode): billing_position_id → {hours, euros}.
          const invByPosition = new Map<number, { hours: number; euros: number }>()
          for (const i of invoiceList) {
            const e = invByPosition.get(i.billing_position_id) ?? { hours: 0, euros: 0 }
            e.hours += i.total_hours; e.euros += i.total_amount_euros
            invByPosition.set(i.billing_position_id, e)
          }

          const emailLines = [
            `hier der Projektstatus zu Ende ${lastInv ? MONTH_FULL[lastInv.month - 1] : ''} ${lastInv?.year ?? ''}:`,
            '',
            `Projekt ${project.project_number}:`,
            `Gesamt        | Summen`,
            `Budget        | ${fmt(project.total_budget_euros)}`,
            `Abgerechnet   | ${fmt(totalInvoiced)}`,
            `Rest          | ${fmt(rest)}`,
          ]
          if (positionMode && invByPosition.size > 0) {
            emailLines.push('', 'Abgerechnet nach Posten:')
            for (const [pid, agg] of [...invByPosition.entries()].sort((a, b) => a[0] - b[0])) {
              emailLines.push(`  ${posLabel(pid)}: ${fmt(agg.euros)}`)
            }
          }
          if (lastInv) {
            emailLines.push('', `Der Rechnungsbetrag für ${MONTH_FULL[lastInv.month - 1]} lautet: ${fmt(lastMonthAmount)}`)
            if (positionMode && lastMonthInvoices.length > 1) {
              for (const i of [...lastMonthInvoices].sort((a, b) => a.billing_position_id - b.billing_position_id)) {
                emailLines.push(`  ${posLabel(i.billing_position_id)}: ${fmt(i.total_amount_euros)}`)
              }
            }
          }
          const emailText = lastInv ? emailLines.join('\n') : ''

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

              {/* Per-position invoiced breakdown (§21 WP6) */}
              {positionMode && billingPositions.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">Abgerechnet nach Posten</p>
                  <div className="space-y-1.5">
                    {billingPositions.map((bp) => {
                      const agg = invByPosition.get(bp.id) ?? { hours: 0, euros: 0 }
                      const posRest = bp.budget_euros - agg.euros
                      return (
                        <div key={bp.id} className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 truncate">{bp.position_number}{bp.description ? ` – ${bp.description}` : ''}</span>
                          <span className="flex items-center gap-4 shrink-0">
                            <span className="text-gray-400 text-xs w-20 text-right">{agg.hours.toFixed(1)} h</span>
                            <span className="text-blue-700 w-28 text-right">{fmt(agg.euros)}</span>
                            <span className="text-gray-400 text-xs w-24 text-right" title="Posten-Budget − abgerechnet">von {fmt(bp.budget_euros)}</span>
                            <span className={`text-xs w-28 text-right ${posRest < -0.01 ? 'text-red-600' : 'text-gray-400'}`}>Rest {fmt(posRest)}</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

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
                      {(positionMode ? ['Monat', 'Posten', 'Stunden', 'Betrag', 'Status', 'Aktionen'] : ['Monat', 'Stunden', 'Betrag', 'Status', 'Aktionen']).map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoiceList.length === 0 && (
                      <tr><td colSpan={positionMode ? 6 : 5} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Abrechnungen.</td></tr>
                    )}
                    {[...invoiceList]
                      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month !== b.month ? a.month - b.month : a.billing_position_id - b.billing_position_id)
                      .map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-700">{MONTH_NAMES[inv.month]} {inv.year}</td>
                        {positionMode && (
                          <td className="px-4 py-3 text-sm text-gray-600">{posLabel(inv.billing_position_id)}</td>
                        )}
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
                        <td className="px-4 py-2.5 text-gray-700" colSpan={positionMode ? 2 : 1}>Gesamt</td>
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
                  { key: 'billing_rate_per_hour', header: 'Stundensatz', render: (m: ProjectMembership) => (
                    <span title={m.billing_position_id != null ? 'Satz vom zugewiesenen Posten' : undefined}>
                      {memberRate(m)} €{m.billing_position_id != null && <span className="ml-1 text-gray-300">(Posten)</span>}
                    </span>
                  ) },
                  ...(billingPositions.length > 0 ? [{
                    key: 'billing_position_id', header: 'Posten',
                    render: (m: ProjectMembership) => {
                      const p = m.billing_position_id != null ? posById.get(m.billing_position_id) : undefined
                      return p
                        ? <span title={p.description}>{p.position_number}</span>
                        : <span className={positionMode ? 'text-red-500' : 'text-gray-300'} title={positionMode ? 'Kein Posten zugewiesen — im Posten-Modus erforderlich' : undefined}>{positionMode ? '⚠ keiner' : '–'}</span>
                    },
                  }] : []),
                  {
                    key: 'priority', header: 'Priorität',
                    render: (m: ProjectMembership) => (
                      <span title="Budget-Priorität: kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral">
                        {m.priority === 0 ? <span className="text-gray-300">–</span> : m.priority}
                      </span>
                    ),
                  },
                  {
                    key: 'vacation_days_taken', header: 'Urlaub genommen',
                    render: (m: ProjectMembership) => (
                      <span title="Bereits genommene Urlaubstage (pauschal, projektbezogen). Werden vom Jahres-Urlaubskontingent abgezogen und senken die geschätzte Abwesenheit.">
                        {m.vacation_days_taken > 0 ? `${m.vacation_days_taken} T` : <span className="text-gray-300">–</span>}
                      </span>
                    ),
                  },
                  {
                    key: 'actions', header: '',
                    render: (m: ProjectMembership) => (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditAssign({ personId: m.person_id, personName: personName(m.person_id) }); setError(null) }}
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
            sick_days_per_year_override: project.sick_days_per_year_override,
            training_days_per_year_override: project.training_days_per_year_override,
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
                <div className="pt-1">
                  <p className="text-xs font-medium text-gray-600 mb-1">Abwesenheits-Richtwerte (Tage/Jahr)</p>
                  <p className="text-[11px] text-gray-400 mb-2">
                    Pauschale für die geschätzte Abwesenheit. Standard = globaler Wert aus den App-Einstellungen;
                    Häkchen entfernen zum Überschreiben (0 = deaktiviert).
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ['sick_days_per_year_override', 'Krankheit'],
                      ['training_days_per_year_override', 'Fortbildung'],
                    ] as const).map(([key, label]) => {
                      const val = sf[key]
                      return (
                        <div key={key}>
                          <label className="block text-xs text-gray-600 mb-1">{label}</label>
                          <input type="number" min={0} step={0.5}
                            disabled={val == null}
                            placeholder="global"
                            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={val ?? ''}
                            onChange={(e) => setSf({ ...sf, [key]: e.target.value === '' ? 0 : parseFloat(e.target.value) })} />
                          <label className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-500">
                            <input type="checkbox" checked={val == null}
                              onChange={(e) => setSf({ ...sf, [key]: e.target.checked ? null : 0 })} />
                            globalen Wert verwenden
                          </label>
                        </div>
                      )
                    })}
                  </div>
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

              {/* Line items (Projektposten) */}
              <BillingPositionsSection
                projectId={projectId}
                totalBudget={project.total_budget_euros}
                positions={billingPositions}
                invoiceList={invoiceList}
                positionMode={positionMode}
              />
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
            {positionMode ? (
              <p className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
                Posten-Modus: Es wird je Posten eine eigene Rechnung erzeugt (Buchungen nach
                Projektebene aufgeteilt, Satz vom Posten). Nicht zugeordnete Buchungen fallen
                auf den unten gewählten Standard-Posten zurück.
              </p>
            ) : null}
            {billingPositions.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {positionMode ? 'Standard-Posten (Fallback)' : 'Rechnungsposition (PSP-Element)'}
                  <span className="ml-1 font-normal text-gray-400">
                    {positionMode ? '— für Buchungen ohne Posten-Zuordnung' : '— welches Arbeitspaket wird abgerechnet?'}
                  </span>
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
            {billingPositions.length === 1 && !positionMode && (
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
          <form onSubmit={(e) => { e.preventDefault(); updatePersonBudget.mutate({ milestoneId: editBudget.milestoneId, budgetId: editBudget.budgetId, hours: editHours }) }} className="space-y-3">
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
                  onClick={() => updatePersonBudget.mutate({ milestoneId: editBudget.milestoneId, budgetId: editBudget.budgetId, hours: editHours, confirm: true })}
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

      {/* Edit estimated absence (days) — manual override */}
      {editAbsence && (
        <Modal title={`Geschätzte Abwesenheit — ${editAbsence.personName}`} onClose={() => setEditAbsence(null)}>
          <form onSubmit={(e) => { e.preventDefault(); setEstAbsence.mutate({ milestoneId: editAbsence.milestoneId, budgetId: editAbsence.budgetId, days: editAbsenceDays }) }} className="space-y-3">
            <p className="text-xs text-gray-500">
              Manuell angenommene Abwesenheitstage (nicht verplanter Resturlaub, pauschal Krank/Fortbildung).
              Ein gesetzter Wert ersetzt die automatische Schätzung, ist gesperrt und fließt in die Verfügbarkeit ein.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Geschätzte Abwesenheit (Tage)</label>
              <input
                autoFocus required type="number" min={0} step={0.1}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={editAbsenceDays}
                onChange={(e) => setEditAbsenceDays(parseFloat(e.target.value))}
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditAbsence(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Speichern (sperren)</button>
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
              {(() => {
                const pos = addMemberForm.billing_position_id != null ? posById.get(addMemberForm.billing_position_id) : undefined
                const fromPosition = pos != null && pos.billing_rate_per_hour > 0
                return (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Stundensatz (€)</label>
                    <input required={!fromPosition} type="number" min={0} step={0.01} disabled={fromPosition}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      title={fromPosition ? 'Satz kommt vom zugewiesenen Posten' : undefined}
                      value={fromPosition ? pos!.billing_rate_per_hour : addMemberForm.billing_rate_per_hour}
                      onChange={(e) => setAddMemberForm({ ...addMemberForm, billing_rate_per_hour: parseFloat(e.target.value) })} />
                  </div>
                )
              })()}
            </div>
            <PositionSelect positions={billingPositions} required={positionMode}
              value={addMemberForm.billing_position_id}
              onChange={(v) => setAddMemberForm({ ...addMemberForm, billing_position_id: v })} />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Priorität <span className="text-gray-400 font-normal">(kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral)</span>
              </label>
              <input type="number" step={1}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={addMemberForm.priority}
                onChange={(e) => setAddMemberForm({ ...addMemberForm, priority: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Bereits genommener Urlaub <span className="text-gray-400 font-normal">(Tage, projektbezogen — reduziert die geschätzte Abwesenheit)</span>
              </label>
              <input type="number" min={0} step={0.5}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={addMemberForm.vacation_days_taken}
                onChange={(e) => setAddMemberForm({ ...addMemberForm, vacation_days_taken: parseFloat(e.target.value) || 0 })} />
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

      {/* Posten-Zuweisungs-Liste eines MA (mehrere Posten je MA) */}
      {editAssign && (
        <MemberAssignmentsModal
          projectId={projectId}
          person={{ id: editAssign.personId, name: editAssign.personName }}
          memberships={memberships}
          positions={billingPositions}
          positionMode={positionMode}
          onClose={() => setEditAssign(null)}
          onSaved={(warnings) => {
            qc.invalidateQueries({ queryKey: ['memberships', projectId] })
            invalidateMilestones()
            setEditAssign(null)
            if (warnings.length > 0) setMemberWarnings(warnings)
          }}
        />
      )}

      {/* Edit membership modal (legacy single-Posten — nur noch als Fallback) */}
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
              {(() => {
                const pos = editMemberForm.billing_position_id != null ? posById.get(editMemberForm.billing_position_id) : undefined
                const fromPosition = pos != null && pos.billing_rate_per_hour > 0
                return (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Stundensatz (€)</label>
                    <input required={!fromPosition} type="number" min={0} step={0.01} disabled={fromPosition}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400"
                      title={fromPosition ? 'Satz kommt vom zugewiesenen Posten' : undefined}
                      value={fromPosition ? pos!.billing_rate_per_hour : editMemberForm.billing_rate_per_hour}
                      onChange={(e) => setEditMemberForm({ ...editMemberForm, billing_rate_per_hour: parseFloat(e.target.value) })} />
                  </div>
                )
              })()}
            </div>
            <PositionSelect positions={billingPositions} required={positionMode}
              value={editMemberForm.billing_position_id}
              onChange={(v) => setEditMemberForm({ ...editMemberForm, billing_position_id: v })} />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Priorität <span className="text-gray-400 font-normal">(kleiner = höher, gleicher Wert = gleiche Stufe, 0 = neutral)</span>
              </label>
              <input type="number" step={1}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={editMemberForm.priority}
                onChange={(e) => setEditMemberForm({ ...editMemberForm, priority: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Bereits genommener Urlaub <span className="text-gray-400 font-normal">(Tage, projektbezogen — reduziert die geschätzte Abwesenheit)</span>
              </label>
              <input type="number" min={0} step={0.5}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={editMemberForm.vacation_days_taken}
                onChange={(e) => setEditMemberForm({ ...editMemberForm, vacation_days_taken: parseFloat(e.target.value) || 0 })} />
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
