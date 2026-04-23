import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { calendar, type CalendarAbsence, type CalendarMembership, type CalendarPerson } from '../api'
import PageHeader from '../components/PageHeader'

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function weekdayIndex(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay() // 0=Sun, 6=Sat
}

function isWeekend(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day).getDay()
  return d === 0 || d === 6
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function absenceOnDay(absence: CalendarAbsence, dateStr: string): boolean {
  const end = absence.end_date ?? '9999-12-31' // ongoing sick
  return absence.start_date <= dateStr && end >= dateStr
}

function membershipOnDay(m: CalendarMembership, dateStr: string): boolean {
  return m.from_date <= dateStr && m.to_date >= dateStr
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

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
  const membership = showProjects
    ? person.memberships.find((m) => membershipOnDay(m, dateStr))
    : undefined

  let bg = 'bg-white'
  let label = ''
  let title = ''

  if (weekend) {
    bg = 'bg-gray-100'
  } else if (absence) {
    bg = ABSENCE_BG[absence.absence_type] ?? 'bg-gray-200'
    label = ABSENCE_LABEL[absence.absence_type] ?? '?'
    title = `${ABSENCE_NAME[absence.absence_type]} (${STATUS_NAME[absence.status]})`
    if (holidayName && showHolidays) title += ` · ${holidayName}`
  } else if (holidayName && showHolidays) {
    bg = 'bg-red-100'
    title = holidayName
  } else if (membership) {
    bg = 'bg-slate-100'
    label = membership.project_number.replace(/\D/g, '').slice(-3) // last 3 digits
    title = `${membership.project_number} – ${membership.project_name}`
  }

  return (
    <td
      className={`h-8 min-w-[2rem] w-8 border-r border-gray-100 text-center text-[10px] font-medium leading-8 select-none ${bg}`}
      title={title || undefined}
    >
      {label}
    </td>
  )
}

// ─── Layer toggle chip ────────────────────────────────────────────────────────

function LayerChip({
  color,
  label,
  active,
  onToggle,
}: {
  color: string
  label: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity border ${
        active ? 'opacity-100 border-gray-300' : 'opacity-40 border-gray-200'
      }`}
    >
      <span className={`inline-block w-3 h-3 rounded-sm ${color}`} />
      {label}
    </button>
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

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', year, month],
    queryFn: () => calendar.get(year, month),
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

  const milestones = data?.milestones ?? []

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Kalender"
        subtitle={`${MONTH_NAMES[month - 1]} ${year}`}
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={prevMonth}
              aria-label="Vorheriger Monat"
              className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[9rem] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={nextMonth}
              aria-label="Nächster Monat"
              className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      <div className="px-6 pt-3 pb-2 flex items-center gap-2 flex-wrap border-b border-gray-100">
        <LayerChip color="bg-red-200" label="Feiertage" active={showHolidays} onToggle={() => setShowHolidays((v) => !v)} />
        <LayerChip color="bg-blue-200" label="Urlaub" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-yellow-200" label="Krank" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-emerald-200" label="Fortbildung" active={showAbsences} onToggle={() => setShowAbsences((v) => !v)} />
        <LayerChip color="bg-slate-200" label="Projekte" active={showProjects} onToggle={() => setShowProjects((v) => !v)} />

        {milestones.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            {milestones.map((ms) => (
              <span
                key={ms.project_id}
                className={`px-2 py-0.5 rounded-full font-medium ${
                  ms.is_locked
                    ? 'bg-green-100 text-green-700'
                    : ms.status === 'closed'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-orange-100 text-orange-700'
                }`}
                title={`Meilenstein ${ms.project_number} – ${ms.is_locked ? 'gesperrt' : ms.status}`}
              >
                {ms.project_number}
              </span>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="p-6 text-sm text-gray-400">Lade…</p>
      ) : !data || data.persons.length === 0 ? (
        <p className="p-6 text-sm text-gray-400">Keine Personen vorhanden.</p>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50">
                  {/* Person column header */}
                  <th
                    className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-r border-gray-200 min-w-[10rem]"
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
                        className={`w-8 min-w-[2rem] border-b border-r border-gray-200 py-1 text-center ${
                          weekend ? 'bg-gray-100 text-gray-400' : holiday && showHolidays ? 'bg-red-50 text-red-500' : 'text-gray-500'
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
                {data.persons.map((person, idx) => (
                  <tr
                    key={person.id}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-0 border-b border-r border-gray-100 text-sm font-medium text-gray-700 whitespace-nowrap">
                      {person.name}
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

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-blue-200" /> Urlaub
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-yellow-200" /> Krank
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-emerald-200" /> Fortbildung
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-red-100" /> Feiertag
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-slate-100 border border-slate-200" /> Projekt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-4 rounded bg-gray-100" /> Wochenende
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
