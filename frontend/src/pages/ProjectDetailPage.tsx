import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, RefreshCw, Lock, Unlock, TrendingUp, FileText, Plus, Trash2, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import {
  projects, persons, programs, invoices as invoiceApi,
  type Project, type Program, type ProjectMembership, type MonthlyInvoice, type MilestoneDetail, type MilestoneSuggestion,
} from '../api'
import Modal from '../components/Modal'
import Table from '../components/Table'

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
]

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

type Tab = 'milestones' | 'rebalancing' | 'invoices' | 'members' | 'settings'

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

  // Queries
  const { data: project } = useQuery({ queryKey: ['project', projectId], queryFn: () => projects.get(projectId) })
  const { data: program } = useQuery({
    queryKey: ['program', project?.program_id],
    queryFn: () => programs.get(project!.program_id!),
    enabled: !!project?.program_id,
  })
  const { data: milestones = [] } = useQuery({ queryKey: ['milestones', projectId], queryFn: () => projects.milestones(projectId) })
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
    mutationFn: () => projects.initMilestones(projectId),
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

  if (!project) return <div className="p-6 text-sm text-gray-400">Lade…</div>

  const tabs: { id: Tab; label: string }[] = [
    { id: 'milestones', label: 'Meilensteine' },
    { id: 'rebalancing', label: 'Rebalancing' },
    { id: 'invoices', label: 'Rechnungen' },
    { id: 'members', label: 'Mitglieder' },
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
              {project.start_date} – {project.end_date} · {project.total_budget_hours.toLocaleString('de-DE')} Std.
              {project.total_budget_euros != null && (
                <> · {project.total_budget_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })}</>
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
          const suggMap: Record<number, number> = {}
          suggestions.forEach((s: MilestoneSuggestion) => {
            suggMap[s.milestone_id] = s.total_current_hours
          })
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
              euros: acc.euros + d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0),
            }),
            { initial: 0, current: 0, euros: 0 },
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
                    initMilestones.mutate()
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Kapazität bei Initialisierung (Arbeitstage × h/Woche, abzgl. Feiertage und Abwesenheiten)">Plan (init.)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Aktuell geplante Stunden inkl. manueller Anpassungen. Fortschrittsbalken = gebuchte / geplante Stunden.">Aktuell (angepasst)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Vom Rebalancing-Algorithmus vorgeschlagene Stundenverteilung auf Basis des Restbudgets">Rebalanciert</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase" title="Geplante Kosten: Summe(Stunden × Verrechnungssatz) je Person">Budget (€)</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {milestonesDetail.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Noch keine Meilensteine. Bitte initialisieren.</td></tr>
                    )}
                    {milestonesDetail.map((d: MilestoneDetail) => {
                      const ms = d.milestone
                      const expanded = expandedMilestones.has(ms.id)
                      const euros = d.persons.reduce((s, p) => s + p.current_hours * p.billing_rate_per_hour, 0)
                      const rebalanced = suggMap[ms.id]
                      const totalBooked = d.persons.reduce((s, p) => s + (p.booked_hours ?? 0), 0)
                      const pct = ms.current_hours > 0 ? Math.min(150, (totalBooked / ms.current_hours) * 100) : 0
                      const barColor = pct > 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-blue-500'
                      return [
                        <tr key={ms.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(ms.id)}>
                          <td className="px-4 py-3 text-gray-400">
                            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-700">{MONTH_NAMES[ms.month]} {ms.year}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{ms.initial_hours.toFixed(1)} h</td>
                          <td className="px-4 py-3">
                            <div className="min-w-[8rem]">
                              <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>{totalBooked.toFixed(1)} h</span>
                                <span>{ms.current_hours.toFixed(1)} h</span>
                              </div>
                              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-blue-600">
                            {rebalanced != null ? `${rebalanced.toFixed(1)} h` : <span className="text-gray-300">–</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {euros > 0 ? euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : <span className="text-gray-300">–</span>}
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
                            </div>
                          </td>
                        </tr>,
                        expanded && d.persons.length > 0 && (
                          <tr key={`${ms.id}-persons`}>
                            <td colSpan={8} className="p-0">
                              <table className="w-full bg-slate-50 border-t border-slate-100">
                                <thead>
                                  <tr className="text-xs text-gray-400 border-b border-slate-100">
                                    <th className="pl-12 pr-4 py-1.5 text-left font-normal">Person</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Kapazität bei Initialisierung">Plan</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Aktuell geplante Stunden (manuell anpassbar)">Aktuell</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Aus Sage importierte Buchungen">Gebucht</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Effektive Personenwochenstunden: Aktuell ÷ (Arbeitstage / 5). Zeigt den impliziten wöchentlichen Aufwand aus den geplanten Stunden.">Eff. PWS</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Abweichung der effektiven PWS zur Ziel-PWS aus der Projektmitgliedschaft. Positiv = mehr als geplant, negativ = weniger.">Δ PWS</th>
                                    <th className="px-4 py-1.5 text-left font-normal" title="Arbeitstage im Monat (Mo–Fr, exkl. Feiertage und außerhalb der Mitgliedschaft)">Arbeitstage</th>
                                    <th className="px-4 py-1.5 text-left font-normal">Abwesenheit</th>
                                    <th className="px-4 py-1.5 text-left font-normal">Feiertage</th>
                                    <th className="px-4 py-1.5"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.persons.map((p) => {
                                    const targetPws = memberships.find(m => m.person_id === p.person_id)?.weekly_capacity_hours ?? null
                                    const effPws = p.work_days > 0 ? p.current_hours * 5 / p.work_days : null
                                    const deltaPws = effPws !== null && targetPws !== null ? effPws - targetPws : null
                                    return (
                                    <tr key={p.person_id} className="text-sm border-b border-slate-100 last:border-0">
                                      <td className="pl-12 pr-4 py-2 text-gray-700">{p.person_name}</td>
                                      <td className="px-4 py-2 text-gray-500">{p.initial_hours.toFixed(1)} h</td>
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
                        <td></td>
                        <td className="px-4 py-3 text-gray-700">
                          {totals.euros > 0 ? totals.euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : '–'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm font-normal">
                          Vertrag: {project.total_budget_hours.toLocaleString('de-DE')} h
                          {project.total_budget_euros != null && <><br/>{project.total_budget_euros.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })}</>}
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
        {tab === 'invoices' && (
          <div>
            <div className="flex justify-between items-center mb-4">
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
                            <>
                              <button onClick={() => advanceStatus.mutate({ id: inv.id, status: 'invoiced' })}
                                className="text-xs text-blue-600 hover:underline">Abrechnen</button>
                              <button onClick={() => setConfirmReopenId(inv.id)}
                                className="text-xs text-gray-400 hover:text-red-500">Wiedereröffnen</button>
                            </>
                          )}
                          {inv.status === 'invoiced' && (
                            <button onClick={() => advanceStatus.mutate({ id: inv.id, status: 'paid' })}
                              className="text-xs text-green-600 hover:underline">Als bezahlt markieren</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
                  <label className="block text-xs font-medium text-gray-600 mb-1">Budget (Std.)</label>
                  <input required type="number" min={0} step={0.01} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.total_budget_hours} onChange={(e) => setSf({ ...sf, total_budget_hours: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Budget (€) <span className="font-normal text-gray-400">optional</span></label>
                  <input type="number" min={0} step={0.01} className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={sf.total_budget_euros ?? ''} onChange={(e) => setSf({ ...sf, total_budget_euros: e.target.value ? parseFloat(e.target.value) : null })} />
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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">PSP-Position</label>
              <select required className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                value={closeForm.billing_position_id}
                onChange={(e) => setCloseForm({ ...closeForm, billing_position_id: parseInt(e.target.value) })}>
                <option value={0} disabled>— bitte wählen —</option>
                {billingPositions.map((bp) => (
                  <option key={bp.id} value={bp.id}>{bp.position_number} – {bp.description}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowCloseModal(false); setError(null) }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
              <button type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Abschließen</button>
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
          <p className="text-sm text-gray-700 mb-4">
            Es sind bereits {milestonesDetail.length} Meilensteine vorhanden. Neue Monate werden hinzugefügt (bestehende werden nicht überschrieben). Fortfahren?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowReinitConfirm(false)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Abbrechen</button>
            <button onClick={() => { setShowReinitConfirm(false); initMilestones.mutate() }}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Fortfahren</button>
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
