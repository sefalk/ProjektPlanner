import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  Legend as ChartLegend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  calendar, programs, projects as projectsApi,
  type CalendarAbsence, type CalendarMembership, type CalendarPerson,
  type CalendarMilestone, type MilestoneSuggestion,
} from '../api'
import PageHeader from '../components/PageHeader'

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const ABSENCE_BG: Record<string, string> = {
  vacation: 'bg-blue-200',
  sick: 'bg-yellow-200',
  training: 'bg-emerald-200',
}

const ABSENCE_LABEL: Record<string, string> = {
  vacation: 'U',
  sick: 'K',
  training: 'F',
}

const ABSENCE_NAME: Record<string, string> = {
  vacation: 'Urlaub',
  sick: 'Krank',
  training: 'Fortbildung',
}

const STATUS_NAME: Record<string, string> = {
  planned: 'geplant',
  confirmed: 'bestätigt',
  ongoing: 'laufend',
}

// Deterministic project colors from a palette
const PROJECT_PALETTE = [
  'bg-slate-300', 'bg-sky-300', 'bg-violet-300', 'bg-rose-300',
  'bg-amber-300', 'bg-teal-300', 'bg-pink-300', 'bg-lime-300',
]
function projectColor(projectId: number) {
  return PROJECT_PALETTE[projectId % PROJECT_PALETTE.length]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
}

function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day).getDay()
  return d === 0 || d === 6
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function absenceOnDay(absence: CalendarAbsence, dateStr: string): boolean {
  const end = absence.end_date ?? '9999-12-31'
  return absence.start_date <= dateStr && end >= dateStr
}

function membershipOnDay(m: CalendarMembership, dateStr: string): boolean {
  return m.from_date <= dateStr && m.to_date >= dateStr
}

// ─── DayCell ─────────────────────────────────────────────────────────────────

function DayCell({
  dateStr,
  weekend,
  holidayName,
  person,
  showHolidays,
  showAbsences,
  showProjects,
}: {
  dateStr: string
  weekend: boolean
  holidayName: string | undefined
  person: CalendarPerson
  showHolidays: boolean
  showAbsences: boolean
  showProjects: boolean
}) {
  const absence = showAbsences
    ? person.absences.find((a) => absenceOnDay(a, dateStr))
    : undefined
  const activeMemberships = showProjects && !absence && !weekend
    ? person.memberships.filter((m) => membershipOnDay(m, dateStr))
    : []

  if (weekend) {
    return <td className="h-8 min-w-[2rem] w-8 border-r border-gray-100 bg-gray-100" />
  }

  if (absence) {
    const bg = ABSENCE_BG[absence.absence_type] ?? 'bg-gray-200'
    const label = ABSENCE_LABEL[absence.absence_type] ?? '?'
    let title = `${ABSENCE_NAME[absence.absence_type]} (${STATUS_NAME[absence.status]})`
    if (holidayName && showHolidays) title += ` · ${holidayName}`
    return (
      <td className={`h-8 min-w-[2rem] w-8 border-r border-gray-100 text-center text-[10px] font-medium leading-8 select-none ${bg}`} title={title}>
        <Link to={`/persons/${person.id}`} className="block w-full h-full">{label}</Link>
      </td>
    )
  }

  if (holidayName && showHolidays) {
    return (
      <td className="h-8 min-w-[2rem] w-8 border-r border-gray-100 bg-red-100 text-center text-[10px] font-medium leading-8 select-none" title={holidayName}>
        •
      </td>
    )
  }

  if (activeMemberships.length > 0) {
    const totalCap = person.default_weekly_hours > 0 ? person.default_weekly_hours : 40
    return (
      <td className="h-8 min-w-[2rem] w-8 border-r border-gray-100 relative overflow-hidden bg-white select-none">
        {activeMemberships.map((m) => {
          const frac = Math.min(1, m.weekly_capacity_hours / totalCap)
          return (
            <div
              key={m.project_id}
              className={`absolute bottom-0 left-0 right-0 ${projectColor(m.project_id)}`}
              style={{ height: `${frac * 100}%` }}
              title={`${m.project_number}: ${m.weekly_capacity_hours} h/Woche`}
            />
          )
        })}
      </td>
    )
  }

  return <td className="h-8 min-w-[2rem] w-8 border-r border-gray-100 bg-white" />
}

// ─── Layer toggle chip ────────────────────────────────────────────────────────

function LayerChip({ color, label, active, onToggle }: { color: string; label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity border ${active ? 'opacity-100 border-gray-300' : 'opacity-40 border-gray-200'}`}
    >
      <span className={`inline-block w-3 h-3 rounded-sm ${color}`} />
      {label}
    </button>
  )
}

// ─── Milestone badge with tooltip ────────────────────────────────────────────

function MilestoneBadge({ ms }: { ms: CalendarMilestone }) {
  return (
    <span className="relative group cursor-default">
      <Link
        to={`/projects/${ms.project_id}`}
        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          ms.is_locked ? 'bg-green-100 text-green-700' : ms.status === 'closed' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
        }`}
      >
        {ms.project_number}
      </Link>
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-52 bg-gray-800 text-white text-xs rounded p-2 shadow-lg pointer-events-none">
        <p className="font-semibold mb-1">{ms.project_number}</p>
        <p className="flex justify-between"><span>Plan:</span><span>{ms.initial_hours.toFixed(1)} h</span></p>
        <p className="flex justify-between"><span>Aktuell:</span><span>{ms.current_hours.toFixed(1)} h</span></p>
        <p className="flex justify-between mt-1"><span>Status:</span><span>{ms.status === 'closed' ? 'Abgeschlossen' : 'Offen'}{ms.is_locked ? ' · gesperrt' : ''}</span></p>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </div>
    </span>
  )
}

// ─── Forecast chart ──────────────────────────────────────────────────────────

function ForecastChart({ projectId }: { projectId: number }) {
  const { data: proj } = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId) })
  const { data: milestones = [] } = useQuery({ queryKey: ['milestones', projectId], queryFn: () => projectsApi.milestones(projectId) })
  const { data: suggestionsList = [] } = useQuery({ queryKey: ['suggestions', projectId], queryFn: () => projectsApi.suggestions(projectId) })

  if (!proj || milestones.length === 0) return null

  const today = new Date()
  const suggMap: Record<number, number> = {}
  suggestionsList.forEach((s: MilestoneSuggestion) => { suggMap[s.milestone_id] = s.total_current_hours })

  let cumPlan = 0, cumActual = 0, cumPrognose = 0
  const chartData = milestones.map((ms) => {
    const isPastOrCurrent = ms.year < today.getFullYear() || (ms.year === today.getFullYear() && ms.month <= today.getMonth() + 1)
    cumPlan += ms.initial_hours
    cumActual += ms.current_hours
    if (isPastOrCurrent) {
      cumPrognose += ms.current_hours
    } else {
      cumPrognose += suggMap[ms.id] ?? ms.current_hours
    }
    return {
      label: `${MONTH_SHORT[ms.month - 1]} ${ms.year}`,
      plan: Math.round(cumPlan * 10) / 10,
      aktuell: Math.round(cumActual * 10) / 10,
      prognose: Math.round(cumPrognose * 10) / 10,
    }
  })

  const budget = proj.total_budget_hours

  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">
        Budgetverlauf — {proj.project_number}: {proj.name}
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit=" h" />
          <ChartTooltip formatter={(v: number) => [`${v} h`]} />
          <ChartLegend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={budget} stroke="#ef4444" strokeDasharray="6 3" label={{ value: `Budget ${budget} h`, position: 'right', fontSize: 11, fill: '#ef4444' }} />
          <Line type="monotone" dataKey="plan" name="PLAN (Init.)" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="aktuell" name="Aktuell" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="prognose" name="Prognose" stroke="#f97316" strokeWidth={2} strokeDasharray="4 2" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const [showHolidays, setShowHolidays] = useState(true)
  const [showAbsences, setShowAbsences] = useState(true)
  const [showProjects, setShowProjects] = useState(true)

  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', year, month],
    queryFn: () => calendar.get(year, month),
  })

  const { data: programList = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: programs.list,
  })

  const { data: projectList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1) }
    else setMonth((m) => m + 1)
  }

  const numDays = daysInMonth(year, month)
  const days = Array.from({ length: numDays }, (_, i) => i + 1)

  const holidayMap: Record<string, string> = {}
  data?.holidays.forEach((h) => { holidayMap[h.holiday_date] = h.name })

  const milestones: CalendarMilestone[] = data?.milestones ?? []

  // Project filter: IDs of projects belonging to selected program, or just the one selected project
  const programProjectIds = selectedProgramId != null
    ? projectList.filter((p) => p.program_id === selectedProgramId).map((p) => p.id)
    : null

  const activeFilterIds: number[] | null =
    selectedProjectId != null ? [selectedProjectId]
    : programProjectIds

  // Filter persons: hide those without memberships in active filter
  const visiblePersons: CalendarPerson[] = data?.persons.filter((p) => {
    if (!activeFilterIds) return true
    return p.memberships.some((m) => activeFilterIds.includes(m.project_id))
  }) ?? []

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Kalender"
        subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
        actions={
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} aria-label="Vorheriger Monat" className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[9rem] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button onClick={nextMonth} aria-label="Nächster Monat" className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {/* Filters + layer chips */}
      <div className="px-6 pt-3 pb-2 flex flex-wrap items-center gap-2 border-b border-gray-100">
        {/* Program filter */}
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={selectedProgramId ?? ''}
          onChange={(e) => {
            const val = e.target.value ? parseInt(e.target.value) : null
            setSelectedProgramId(val)
            setSelectedProjectId(null)
          }}
        >
          <option value="">Alle Hauptprojekte</option>
          {programList.map((p) => (
            <option key={p.id} value={p.id}>{p.program_number} – {p.name}</option>
          ))}
        </select>

        {/* Project filter */}
        <select
          className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={selectedProjectId ?? ''}
          onChange={(e) => {
            const val = e.target.value ? parseInt(e.target.value) : null
            setSelectedProjectId(val)
            setSelectedProgramId(null)
          }}
        >
          <option value="">Alle Projekte</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.project_number} – {p.name}</option>
          ))}
        </select>

        <div className="w-px h-4 bg-gray-200 mx-1" />

        <LayerChip color="bg-red-200" label="Feiertage" active={showHolidays} onToggle={() => setShowHolidays((v) => !v)} />
        <LayerChip color="bg-blue-200" label="Urlaub" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-yellow-200" label="Krank" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-emerald-200" label="Fortbildung" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-slate-300" label="Projekte" active={showProjects} onToggle={() => setShowProjects((v) => !v)} />

        {milestones.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            {milestones.map((ms) => <MilestoneBadge key={ms.project_id} ms={ms} />)}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <p className="text-sm text-gray-500">Lade…</p>
        ) : !data || data.persons.length === 0 ? (
          <p className="text-sm text-gray-500">Keine Personen vorhanden.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white" tabIndex={0} aria-label="Kalenderansicht">
            <table className="border-collapse text-sm min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th
                    className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-r border-gray-200 min-w-[10rem]"
                    scope="col"
                  >
                    Person
                  </th>
                  {days.map((day) => {
                    const dateStr = isoDate(year, month, day)
                    const weekend = isWeekend(year, month, day)
                    const holiday = holidayMap[dateStr]
                    const wd = weekdayIndex(year, month, day)
                    return (
                      <th
                        key={day}
                        scope="col"
                        className={`w-8 min-w-[2rem] border-b border-r border-gray-200 py-1 text-center ${
                          weekend ? 'bg-gray-100 text-gray-400' : holiday && showHolidays ? 'bg-red-50 text-red-700' : 'text-gray-600'
                        }`}
                        title={holiday ?? undefined}
                      >
                        <div className="text-[10px] font-normal leading-none">{WEEKDAY_SHORT[wd]}</div>
                        <div className="text-xs font-semibold leading-tight">{day}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visiblePersons.length === 0 ? (
                  <tr>
                    <td colSpan={numDays + 1} className="px-4 py-6 text-center text-sm text-gray-400">
                      Keine Personen für diesen Filter.
                    </td>
                  </tr>
                ) : visiblePersons.map((person, idx) => (
                  <tr key={person.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-0 border-b border-r border-gray-100 text-sm font-medium whitespace-nowrap">
                      <Link to={`/persons/${person.id}`} className="text-gray-700 hover:text-blue-600 hover:underline">
                        {person.name}
                      </Link>
                    </td>
                    {days.map((day) => {
                      const dateStr = isoDate(year, month, day)
                      const weekend = isWeekend(year, month, day)
                      return (
                        <DayCell
                          key={day}
                          dateStr={dateStr}
                          weekend={weekend}
                          holidayName={holidayMap[dateStr]}
                          person={person}
                          showHolidays={showHolidays}
                          showAbsences={showAbsences}
                          showProjects={showProjects}
                        />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600" aria-label="Legende">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-blue-200" /> Urlaub</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-yellow-200" /> Krank</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-emerald-200" /> Fortbildung</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-red-100" /> Feiertag</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-slate-300 border border-slate-200" /> Projekt (100%)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-gray-100 border border-gray-200" /> Wochenende</span>
        </div>

        {/* Forecast chart — only when a specific project is selected */}
        {selectedProjectId != null && (
          <ForecastChart projectId={selectedProjectId} />
        )}
      </div>
    </div>
  )
}
