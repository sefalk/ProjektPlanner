import { useState } from 'react'
import { useQuery, useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip,
  Legend as ChartLegend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import {
  calendar, programs, projects as projectsApi,
  type CalendarAbsence, type CalendarMembership, type CalendarPerson,
  type CalendarMilestone, type MilestoneSuggestion, type Project,
} from '../api'
import PageHeader from '../components/PageHeader'
import {
  TYPE_BAR_BG as ABSENCE_BG,
  TYPE_SHORT as ABSENCE_LABEL,
  TYPE_LABELS as ABSENCE_NAME,
  STATUS_LABELS as STATUS_NAME,
} from '../lib/absenceColors'

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

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

/** Hover tooltip for an absence: type/status, range and what it books
 *  (working days & hours, minus weekends/holidays/non-working days; for vacation
 *  the contingent consumed after the confirmed-sick (AU) refund). */
function absenceTooltip(a: CalendarAbsence): string {
  const lines = [`${ABSENCE_NAME[a.absence_type]} (${STATUS_NAME[a.status]})`]
  lines.push(`${a.start_date} – ${a.end_date ?? 'laufend'}`)
  if (a.booked_working_days != null) {
    lines.push(`Bucht: ${a.booked_working_days} Arbeitstag(e) · ${a.booked_hours ?? 0} h`)
    if (a.absence_type === 'vacation' && a.contingent_days != null && a.contingent_days !== a.booked_working_days) {
      lines.push(`Urlaubskontingent: ${a.contingent_days} (${a.booked_working_days - a.contingent_days} durch AU erstattet)`)
    }
  }
  return lines.join('\n')
}

// Clamp membership dates to the visible month, returning 1-based day numbers
function membershipStartDay(fromDate: string, year: number, month: number): number {
  if (fromDate <= isoDate(year, month, 1)) return 1
  return parseInt(fromDate.split('-')[2], 10)
}

function membershipEndDay(toDate: string, year: number, month: number, numDays: number): number {
  if (toDate >= isoDate(year, month, numDays)) return numDays
  return parseInt(toDate.split('-')[2], 10)
}

// ─── PersonRow ───────────────────────────────────────────────────────────────

function PersonRow({
  person, year, month, days, numDays, todayStr, holidayMap,
  showHolidays, showAbsences, showProjects, rowClass,
  viewMode, personMilestoneHours, personBookedHours, workDaysInMonth,
  workDaysElapsed, isCurrentMonth,
}: {
  person: CalendarPerson
  year: number; month: number; days: number[]; numDays: number; todayStr: string
  holidayMap: Record<string, string>
  showHolidays: boolean; showAbsences: boolean; showProjects: boolean
  rowClass: string
  viewMode: 'availability' | 'milestones'
  personMilestoneHours: Record<number, number>
  personBookedHours: Record<number, number>
  workDaysInMonth: number
  workDaysElapsed: number
  isCurrentMonth: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const totalCap = person.default_weekly_hours > 0 ? person.default_weekly_hours : 40
  const firstDay = isoDate(year, month, 1)
  const lastDay = isoDate(year, month, numDays)

  const activeMembers = person.memberships.filter((m) => m.from_date <= lastDay && m.to_date >= firstDay)

  // Utilization badge — differs by view mode
  const activeCap = activeMembers.reduce((sum, m) => sum + m.weekly_capacity_hours, 0)
  let badgeValue: number
  let badgeTitle: string
  if (viewMode === 'milestones') {
    const totalMsHours = Object.values(personMilestoneHours).reduce((s, h) => s + h, 0)
    const totalBooked = Object.values(personBookedHours).reduce((s, h) => s + h, 0)
    const monthlyCapacity = workDaysInMonth > 0 ? (totalCap / 5) * workDaysInMonth : totalCap * 4.33
    badgeValue = Math.round(totalMsHours / monthlyCapacity * 100)
    const sollToDate = isCurrentMonth && workDaysInMonth > 0
      ? totalMsHours * workDaysElapsed / workDaysInMonth
      : null
    badgeTitle = [
      `Meilenstein: ${totalMsHours.toFixed(1)} h geplant · ${totalBooked.toFixed(1)} h gebucht`,
      `Monatskapazität: ${monthlyCapacity.toFixed(0)} h`,
      sollToDate != null
        ? `Soll bis heute: ${sollToDate.toFixed(1)} h · Ist: ${totalBooked.toFixed(1)} h`
        : null,
    ].filter(Boolean).join(' · ')
  } else {
    badgeValue = Math.round((activeCap / totalCap) * 100)
    badgeTitle = `Projektanteil: ${activeCap} h/Woche (von ${totalCap} h/Woche gesamt)`
  }
  const badgeCls = badgeValue > 100 ? 'bg-red-100 text-red-700'
    : badgeValue >= 80 ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-500'

  // Pre-compute stacked membership bars (bottom → top)
  type Bar = { m: CalendarMembership; startDay: number; endDay: number; frac: number; bookedFrac: number; bottom: number; label: string }
  const bars: Bar[] = []
  if (showProjects) {
    let stackBottom = 0
    for (const m of person.memberships) {
      if (m.from_date > lastDay || m.to_date < firstDay) continue
      const startDay = membershipStartDay(m.from_date, year, month)
      const endDay = membershipEndDay(m.to_date, year, month, numDays)
      let frac: number
      let label: string
      let bookedFrac = 0
      if (viewMode === 'milestones') {
        const msHours = personMilestoneHours[m.project_id] ?? 0
        const bookedHours = personBookedHours[m.project_id] ?? 0
        const monthlyCapacity = workDaysInMonth > 0 ? (m.weekly_capacity_hours / 5) * workDaysInMonth : m.weekly_capacity_hours * 4.33
        frac = monthlyCapacity > 0 ? Math.min(1, msHours / monthlyCapacity) : 0
        bookedFrac = msHours > 0 ? Math.min(1, bookedHours / msHours) : 0
        const bookedPct = Math.round(bookedFrac * 100)
        label = msHours > 0
          ? `${m.project_number} · ${msHours.toFixed(0)} h Soll · ${bookedHours.toFixed(0)} h Ist (${bookedPct}%)`
          : `${m.project_number} · kein Meilenstein`
      } else {
        frac = Math.min(1, m.weekly_capacity_hours / totalCap)
        label = `${m.project_number} · ${Math.round(frac * 100)}%`
      }
      bars.push({ m, startDay, endDay, frac, bookedFrac, bottom: stackBottom, label })
      stackBottom += frac * 100
    }
  }
  const totalFrac = activeCap / totalCap
  const overbooked = viewMode === 'availability' && totalFrac > 1.005

  return (
    <>
      <tr className={rowClass}>
        {/* Sticky person name + expand toggle + utilization badge */}
        <td className="sticky left-0 z-10 bg-inherit px-2 py-0 h-8 border-b border-r border-gray-100 text-sm font-medium whitespace-nowrap">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mr-1 text-gray-400 hover:text-gray-600 inline-flex items-center"
            aria-label={expanded ? 'Einklappen' : 'Ausklappen'}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
          </button>
          <Link to={`/persons/${person.id}`} className="text-gray-700 hover:text-blue-600 hover:underline">
            {person.name}
          </Link>
          <span
            className={`ml-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold leading-none ${badgeCls}`}
            title={badgeTitle}
          >
            {badgeValue}%
          </span>
        </td>

        {/* Single cell spanning all day columns — layered */}
        <td colSpan={numDays} className="p-0 h-8 border-b border-gray-100 relative overflow-hidden">

          {/* Layer 0: per-day backgrounds — only today indicator, no weekend/holiday here */}
          <div className="absolute inset-0 flex pointer-events-none" aria-hidden="true">
            {days.map((day) => {
              const dateStr = isoDate(year, month, day)
              const isToday = dateStr === todayStr
              return (
                <div
                  key={day}
                  className={`flex-shrink-0 border-r border-gray-100 ${
                    isToday ? 'bg-blue-50 border-l-2 border-l-blue-400' : 'bg-white'
                  }`}
                  style={{ width: '2rem', height: '100%' }}
                />
              )
            })}
          </div>

          {/* Layer 1: continuous membership bars */}
          {bars.map(({ m, startDay, endDay, frac, bookedFrac, bottom, label }) => (
            <div
              key={m.project_id}
              className={`absolute ${projectColor(m.project_id)} flex items-center px-1.5 overflow-hidden`}
              style={{
                left: `calc(${startDay - 1} * 2rem)`,
                width: `calc(${endDay - startDay + 1} * 2rem)`,
                bottom: `${bottom}%`,
                height: `${frac * 100}%`,
              }}
              title={viewMode === 'milestones'
                ? `${m.project_number}: ${(personMilestoneHours[m.project_id] ?? 0).toFixed(1)} h Soll · ${(personBookedHours[m.project_id] ?? 0).toFixed(1)} h Ist · ${m.weekly_capacity_hours} h/W Projektanteil`
                : `${m.project_number}: ${m.weekly_capacity_hours} h/Woche · ${Math.round(frac * 100)}%`}
            >
              {/* Booked (Ist) overlay — fills bar from bottom proportional to booked/planned */}
              {viewMode === 'milestones' && bookedFrac > 0 && (
                <div
                  className={`absolute bottom-0 left-0 right-0 ${bookedFrac >= 1 ? 'bg-green-600/40' : 'bg-black/25'} pointer-events-none`}
                  style={{ height: `${bookedFrac * 100}%` }}
                />
              )}
              <span className="relative text-[9px] font-semibold text-gray-700 leading-none truncate whitespace-nowrap select-none z-10">
                {label}
              </span>
            </div>
          ))}

          {/* Overbooking: thin red stripe at top */}
          {overbooked && (
            <div
              className="absolute top-0 left-0 right-0 h-1 bg-red-500 opacity-70 z-10 pointer-events-none"
              title={`Überbuchung: ${Math.round(totalFrac * 100)}%`}
            />
          )}

          {/* Layer 1.5: semi-transparent weekend/holiday overlays — above project bars */}
          {days.map((day) => {
            const dateStr = isoDate(year, month, day)
            const weekend = isWeekend(year, month, day)
            const holiday = holidayMap[dateStr]
            if (!weekend && !(holiday && showHolidays)) return null
            return (
              <div
                key={`wh-${day}`}
                className={`absolute top-0 bottom-0 pointer-events-none z-10 ${
                  holiday && showHolidays ? 'bg-red-400/25' : 'bg-gray-500/15'
                }`}
                style={{ left: `calc(${day - 1} * 2rem)`, width: '2rem' }}
                title={holiday ?? undefined}
              />
            )
          })}

          {/* Layer 2: absence overlays — per day, on top of everything */}
          {showAbsences && days.map((day) => {
            const dateStr = isoDate(year, month, day)
            const absence = person.absences.find((a) => absenceOnDay(a, dateStr))
            if (!absence) return null
            const bg = ABSENCE_BG[absence.absence_type] ?? 'bg-gray-200'
            const label = ABSENCE_LABEL[absence.absence_type] ?? '?'
            const title = absenceTooltip(absence)
            return (
              <div
                key={day}
                className={`absolute top-0 bottom-0 ${bg} flex items-center justify-center text-[10px] font-medium z-20`}
                style={{ left: `calc(${day - 1} * 2rem)`, width: '2rem' }}
                title={title}
              >
                <Link to={`/persons/${person.id}`} className="flex items-center justify-center w-full h-full">
                  {label}
                </Link>
              </div>
            )
          })}
        </td>
      </tr>

      {/* Expanded sub-rows: one per membership */}
      {expanded && person.memberships.map((m) => {
        const color = projectColor(m.project_id)
        return (
          <tr key={m.project_id} className="bg-gray-50/70">
            <td className="sticky left-0 z-10 bg-gray-50 pl-8 pr-3 py-1 border-b border-r border-gray-100 whitespace-nowrap">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-2 ${color}`} />
              <Link
                to={`/projects/${m.project_id}`}
                className="text-xs font-medium text-gray-600 hover:text-blue-600 hover:underline"
              >
                {m.project_number}
              </Link>
              <span className="ml-1.5 text-xs text-gray-400 truncate max-w-[8rem] inline-block align-bottom" title={m.project_name}>
                {m.project_name}
              </span>
            </td>
            <td colSpan={numDays} className="px-3 py-1 border-b border-gray-100 text-xs text-gray-500">
              {viewMode === 'milestones' ? (() => {
                const msHours = personMilestoneHours[m.project_id] ?? 0
                const bookedHours = personBookedHours[m.project_id] ?? 0
                const monthlyCapacity = workDaysInMonth > 0 ? (m.weekly_capacity_hours / 5) * workDaysInMonth : m.weekly_capacity_hours * 4.33
                const msPct = monthlyCapacity > 0 ? Math.round(msHours / monthlyCapacity * 100) : 0
                const bookedPct = msHours > 0 ? Math.round(bookedHours / msHours * 100) : 0
                const noMilestone = msHours === 0
                const sollToDate = isCurrentMonth && workDaysInMonth > 0 ? msHours * workDaysElapsed / workDaysInMonth : null
                return <>
                  {noMilestone
                    ? <span className="italic text-gray-400">kein Meilenstein für diesen Monat</span>
                    : <>
                      <span className="font-medium text-gray-700" title="Geplante Stunden laut Meilenstein">Soll: {msHours.toFixed(1)} h</span>
                      <span className="mx-1.5 text-gray-300">·</span>
                      <span className={`font-medium ${bookedHours >= msHours ? 'text-green-700' : bookedHours > 0 ? 'text-blue-700' : 'text-gray-500'}`} title="Gebuchte Stunden aus Sage">
                        Ist: {bookedHours.toFixed(1)} h ({bookedPct}%)
                      </span>
                      <span className="mx-1.5 text-gray-300">·</span>
                      <span title="Meilensteinanteil an der gesamten Monatskapazität">{msPct}% von {monthlyCapacity.toFixed(0)} h Monatskapazität</span>
                      {sollToDate != null && <>
                        <span className="mx-1.5 text-gray-300">·</span>
                        <span
                          className={`font-medium ${bookedHours >= sollToDate ? 'text-green-700' : 'text-amber-600'}`}
                          title="Soll/Ist-Vergleich bis zum heutigen Tag"
                        >
                          Soll heute: {sollToDate.toFixed(1)} h
                          {bookedHours < sollToDate && ` (−${(sollToDate - bookedHours).toFixed(1)} h)`}
                        </span>
                      </>}
                    </>
                  }
                </>
              })() : <>
                <span className="font-medium text-gray-700">{m.weekly_capacity_hours} h/Woche</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>{Math.round((m.weekly_capacity_hours / totalCap) * 100)}% der Wochenkapazität</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span>{m.from_date} – {m.to_date}</span>
              </>}
            </td>
          </tr>
        )
      })}
    </>
  )
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
        <p className="flex justify-between"><span>Plan:</span><span>{(ms.initial_hours ?? 0).toFixed(1)} h</span></p>
        <p className="flex justify-between"><span>Aktuell:</span><span>{(ms.current_hours ?? 0).toFixed(1)} h</span></p>
        <p className="flex justify-between mt-1"><span>Status:</span><span>{ms.status === 'closed' ? 'Abgeschlossen' : 'Offen'}{ms.is_locked ? ' · gesperrt' : ''}</span></p>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </div>
    </span>
  )
}

// ─── Forecast chart ──────────────────────────────────────────────────────────

function ForecastChart({
  projectIds,
  allProjects,
}: {
  projectIds: number[]
  allProjects: Project[]
}) {
  const today = new Date()

  const milestoneQueries = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ['milestones', id],
      queryFn: () => projectsApi.milestones(id),
      staleTime: 30_000,
    })),
  })

  const suggestionQueries = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ['recalc-preview', id],
      queryFn: () => projectsApi.recalcPreview(id),
      staleTime: 30_000,
    })),
  })

  const isLoading = milestoneQueries.some((q) => q.isPending)

  if (isLoading) {
    return (
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-400">Lade Budgetdaten…</p>
      </div>
    )
  }

  // Aggregate milestones across all projects
  type AggMs = {
    year: number; month: number
    initial_hours: number; current_hours: number; suggested: number
  }
  const allMs: AggMs[] = []

  projectIds.forEach((_, idx) => {
    const ms = milestoneQueries[idx].data ?? []
    const suggs = suggestionQueries[idx].data ?? []
    const suggMap: Record<number, number> = {}
    suggs.forEach((s: MilestoneSuggestion) => { suggMap[s.milestone_id] = s.total_current_hours })

    ms.forEach((m) => {
      const isPastOrCurrent =
        m.year < today.getFullYear() ||
        (m.year === today.getFullYear() && m.month <= today.getMonth() + 1)
      allMs.push({
        year: m.year,
        month: m.month,
        initial_hours: m.initial_hours,
        current_hours: m.current_hours,
        suggested: isPastOrCurrent ? m.current_hours : (suggMap[m.id] ?? m.current_hours),
      })
    })
  })

  if (allMs.length === 0) {
    return (
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-400 text-center py-4">Keine Meilenstein-Daten — Meilensteine zuerst initialisieren.</p>
      </div>
    )
  }

  // Total budget in hours: prefer explicit hours budget; fall back to sum of milestone initial_hours
  const relevantProjects = allProjects.filter((p) => projectIds.includes(p.id))
  const explicitBudgetHours = relevantProjects.reduce((sum, p) => sum + (p.total_budget_hours ?? 0), 0)
  const planTotalHours = allMs.reduce((sum, ms) => sum + ms.initial_hours, 0)
  const effectiveBudget = explicitBudgetHours > 0 ? explicitBudgetHours : planTotalHours
  const usingFallback = explicitBudgetHours === 0 && planTotalHours > 0

  if (effectiveBudget === 0) {
    return (
      <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-400 text-center py-4">
          Kein Budget und keine Meilensteine — Meilensteine initialisieren oder Stundenbudget hinterlegen.
        </p>
      </div>
    )
  }

  // Group milestones by calendar month, sorted
  const byMonth: Record<string, AggMs[]> = {}
  allMs.forEach((ms) => {
    const key = `${ms.year}-${String(ms.month).padStart(2, '0')}`
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(ms)
  })
  const sortedKeys = Object.keys(byMonth).sort()

  let cumPlan = 0, cumActual = 0, cumPrognose = 0
  const chartData = sortedKeys.map((key) => {
    const [y, m] = key.split('-').map(Number)
    for (const ms of byMonth[key]) {
      cumPlan += ms.initial_hours
      cumActual += ms.current_hours
      cumPrognose += ms.suggested
    }
    return {
      label: `${MONTH_SHORT[m - 1]} ${y}`,
      verblPlan: Math.max(0, Math.round((effectiveBudget - cumPlan) * 10) / 10),
      verblAktuell: Math.max(0, Math.round((effectiveBudget - cumActual) * 10) / 10),
      verblPrognose: Math.max(0, Math.round((effectiveBudget - cumPrognose) * 10) / 10),
    }
  })

  const isSingle = projectIds.length === 1
  const singleProj = isSingle ? relevantProjects[0] : null
  const title = singleProj
    ? `Budgetverlauf — ${singleProj.project_number}: ${singleProj.name}`
    : `Budgetverlauf — ${projectIds.length} Projekte`

  return (
    <div className="mt-6 bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline gap-3 mb-1">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        {usingFallback && (
          <span className="text-xs text-gray-400">
            Kein Stundenbudget gesetzt — Basis: {effectiveBudget.toFixed(0)} h aus Meilenstein-Initialisierung
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            unit=" h"
            domain={[0, Math.ceil(effectiveBudget / 50) * 50]}
          />
          <ChartTooltip formatter={(v) => [`${Number(v).toFixed(1)} h`]} labelFormatter={(l) => `${l} · verbleibend`} />
          <ChartLegend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine
            y={0}
            stroke="#ef4444"
            strokeDasharray="6 3"
            label={{ value: 'Budget erschöpft', position: 'insideBottomRight', fontSize: 10, fill: '#ef4444' }}
          />
          <Line type="monotone" dataKey="verblPlan" name="PLAN verbleibend" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="verblAktuell" name="Aktuell verbleibend" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="verblPrognose" name="Prognose verbleibend" stroke="#f97316" strokeWidth={2} strokeDasharray="4 2" dot={false} />
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
  const [viewMode, setViewMode] = useState<'milestones' | 'availability'>('milestones')

  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)

  const todayStr = isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1

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

  // Compute work days in month (Mon–Fri, excl. public holidays)
  const holidayWorkdayDates = new Set(data?.holidays.filter(h => h.is_workday).map(h =>
    typeof h.holiday_date === 'string' ? h.holiday_date : (h.holiday_date as Date).toISOString().slice(0, 10)
  ))
  let workDaysInMonth = 0
  for (let d = 1; d <= numDays; d++) {
    const dow = weekdayIndex(year, month, d)
    if (dow >= 1 && dow <= 5 && !holidayWorkdayDates.has(isoDate(year, month, d))) workDaysInMonth++
  }

  // Work days elapsed up to today (only meaningful for current month)
  let workDaysElapsed = 0
  if (isCurrentMonth) {
    const todayDay = today.getDate()
    for (let d = 1; d <= todayDay; d++) {
      const dow = weekdayIndex(year, month, d)
      if (dow >= 1 && dow <= 5 && !holidayWorkdayDates.has(isoDate(year, month, d))) workDaysElapsed++
    }
  }

  // Build per-person milestone maps: personId → projectId → hours
  const personMilestoneHoursMap: Record<number, Record<number, number>> = {}
  const personBookedHoursMap: Record<number, Record<number, number>> = {}
  for (const ms of milestones) {
    for (const b of ms.budgets ?? []) {
      if (!personMilestoneHoursMap[b.person_id]) personMilestoneHoursMap[b.person_id] = {}
      if (!personBookedHoursMap[b.person_id]) personBookedHoursMap[b.person_id] = {}
      personMilestoneHoursMap[b.person_id][ms.project_id] = b.current_hours
      personBookedHoursMap[b.person_id][ms.project_id] = b.booked_hours ?? 0
    }
  }

  const programProjectIds = selectedProgramId != null
    ? projectList.filter((p) => p.program_id === selectedProgramId).map((p) => p.id)
    : null

  const activeFilterIds: number[] | null =
    selectedProjectId != null ? [selectedProjectId] : programProjectIds

  const visiblePersons: CalendarPerson[] = data?.persons.filter((p) => {
    if (!activeFilterIds) return true
    return p.memberships.some((m) => activeFilterIds.includes(m.project_id))
  }) ?? []

  // Determine project IDs for the forecast chart
  const forecastProjectIds: number[] =
    selectedProjectId != null ? [selectedProjectId]
    : programProjectIds != null ? programProjectIds
    : projectList.map((p) => p.id)

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
        <select
          aria-label="Hauptprojekt filtern"
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

        <select
          aria-label="Projekt filtern"
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

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border border-gray-200 overflow-hidden text-xs font-medium">
          <button
            onClick={() => setViewMode('milestones')}
            className={`px-2.5 py-1 transition-colors ${viewMode === 'milestones' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            title="Zeigt geplante Meilensteinsstunden je Person und Projekt"
          >
            Meilensteine
          </button>
          <button
            onClick={() => setViewMode('availability')}
            className={`px-2.5 py-1 transition-colors ${viewMode === 'availability' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            title="Zeigt verfügbare Kapazität (PWS) je Person und Projekt"
          >
            Verfügbarkeit
          </button>
        </div>

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
                    const isToday = dateStr === todayStr
                    return (
                      <th
                        key={day}
                        scope="col"
                        className={`w-8 min-w-[2rem] border-b border-r border-gray-200 py-1 text-center ${
                          isToday   ? 'bg-blue-50 text-blue-700 border-t-2 border-t-blue-400'
                          : weekend ? 'bg-gray-100 text-gray-600'
                          : holiday && showHolidays ? 'bg-red-50 text-red-700'
                          : 'text-gray-600'
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
                  <PersonRow
                    key={person.id}
                    person={person}
                    year={year}
                    month={month}
                    days={days}
                    numDays={numDays}
                    todayStr={todayStr}
                    holidayMap={holidayMap}
                    showHolidays={showHolidays}
                    showAbsences={showAbsences}
                    showProjects={showProjects}
                    rowClass={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                    viewMode={viewMode}
                    personMilestoneHours={personMilestoneHoursMap[person.id] ?? {}}
                    personBookedHours={personBookedHoursMap[person.id] ?? {}}
                    workDaysInMonth={workDaysInMonth}
                    workDaysElapsed={workDaysElapsed}
                    isCurrentMonth={isCurrentMonth}
                  />
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
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-red-300/50 border border-red-200" /> Feiertag</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-slate-300 border border-slate-200" /> Projekt (100%)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-gray-500/15 border border-gray-200" /> Wochenende</span>
        </div>

        {/* Forecast chart — always visible */}
        {forecastProjectIds.length > 0 && (
          <ForecastChart projectIds={forecastProjectIds} allProjects={projectList} />
        )}
      </div>
    </div>
  )
}
