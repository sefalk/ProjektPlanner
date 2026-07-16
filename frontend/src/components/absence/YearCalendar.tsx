import { useEffect, useMemo, useRef, useState } from 'react'
import type { YearHoliday, YearCalendarPerson } from '../../api'
import { TYPE_SHORT, TYPE_LABELS, STATUS_LABELS, personColor } from '../../lib/absenceColors'
import { computeAbsenceSegments } from '../../lib/absenceSegments'

// ─── Layout constants ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const DAY_COLS = 31
const CELL_W = '1.6rem'
const LABEL_W = '5.5rem'
const ROW_H = '2.75rem'
const ROW_PX = 44 // must match ROW_H — used to decide when a bar is too thin for a label

// ─── Date helpers ───────────────────────────────────────────────────────────

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate()
}
function weekdayIndex(year: number, monthIdx: number, day: number): number {
  return new Date(year, monthIdx, day).getDay()
}
function isWeekend(year: number, monthIdx: number, day: number): boolean {
  const d = weekdayIndex(year, monthIdx, day)
  return d === 0 || d === 6
}
function isoDate(year: number, monthIdx: number, day: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function fmtDe(iso: string | null): string {
  if (!iso) return 'offen'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function YearCalendar({
  year,
  holidays,
  persons,
}: {
  year: number
  holidays: YearHoliday[]
  persons: YearCalendarPerson[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)
  const [hoveredPersonId, setHoveredPersonId] = useState<number | null>(null)

  const today = new Date()
  const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate())
  const currentMonthIdx = year === today.getFullYear() ? today.getMonth() : null

  const holidayByDate: Record<string, YearHoliday> = {}
  holidays.forEach((h) => { holidayByDate[h.holiday_date] = h })

  const dayNumbers = Array.from({ length: DAY_COLS }, (_, i) => i + 1)
  const months = Array.from({ length: 12 }, (_, i) => i)

  // Absence segments → lanes. Each person with ≥1 absence gets a fixed lane
  // (stable across months so month-spanning bars line up vertically).
  const { segmentsByMonth, laneOf, laneCount } = useMemo(() => {
    const segs = computeAbsenceSegments(persons, year)
    const order: number[] = []
    for (const p of persons) {
      if (order.includes(p.id)) continue
      if (segs.some((s) => s.personId === p.id)) order.push(p.id)
    }
    const lane: Record<number, number> = {}
    order.forEach((id, i) => { lane[id] = i })
    const byMonth: Record<number, typeof segs> = {}
    for (const s of segs) {
      (byMonth[s.monthIdx] ??= []).push(s)
    }
    return { segmentsByMonth: byMonth, laneOf: lane, laneCount: order.length }
  }, [persons, year])

  const laneHpct = laneCount > 0 ? 100 / laneCount : 100
  const laneHpx = laneCount > 0 ? ROW_PX / laneCount : ROW_PX
  const showLabels = laneHpx >= 11

  // Center the current month vertically on mount / year change.
  useEffect(() => {
    const container = scrollRef.current
    const row = currentRowRef.current
    if (!container || !row) return
    container.scrollTop = Math.max(0, row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2)
  }, [year])

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-lg border border-gray-200 bg-white max-h-[70vh]"
      aria-label={`Jahreskalender ${year}`}
    >
      <div className="inline-block min-w-full text-xs">
        {/* Header: day numbers */}
        <div className="flex sticky top-0 z-20 bg-gray-50 border-b border-gray-200">
          <div
            className="sticky left-0 z-30 bg-gray-50 flex-shrink-0 border-r border-gray-200 px-2 py-1 font-semibold text-gray-500 uppercase tracking-wide"
            style={{ width: LABEL_W }}
          >
            Monat
          </div>
          {dayNumbers.map((d) => (
            <div
              key={d}
              className="flex-shrink-0 text-center py-1 text-[10px] font-medium text-gray-400 border-r border-gray-100"
              style={{ width: CELL_W }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* One row per month */}
        {months.map((monthIdx) => {
          const numDays = daysInMonth(year, monthIdx)
          const isCurrent = monthIdx === currentMonthIdx
          const segs = segmentsByMonth[monthIdx] ?? []
          return (
            <div
              key={monthIdx}
              ref={isCurrent ? currentRowRef : undefined}
              className={`flex border-b border-gray-100 ${isCurrent ? 'bg-blue-50/40' : ''}`}
            >
              {/* Sticky month label */}
              <div
                className={`sticky left-0 z-10 flex-shrink-0 flex items-center border-r border-gray-200 px-2 font-medium ${
                  isCurrent ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'
                }`}
                style={{ width: LABEL_W, height: ROW_H }}
              >
                {MONTH_NAMES[monthIdx]}
              </div>

              {/* Day cells + absence bars */}
              <div className="relative flex" style={{ height: ROW_H }}>
                {dayNumbers.map((day) => {
                  const valid = day <= numDays
                  if (!valid) {
                    return (
                      <div
                        key={day}
                        className="flex-shrink-0 bg-gray-50/70 border-r border-gray-100"
                        style={{ width: CELL_W }}
                        aria-hidden="true"
                      />
                    )
                  }
                  const dateStr = isoDate(year, monthIdx, day)
                  const holiday = holidayByDate[dateStr]
                  const weekend = isWeekend(year, monthIdx, day)
                  const isToday = dateStr === todayStr
                  const wd = weekdayIndex(year, monthIdx, day)
                  const bg = holiday ? 'bg-red-100' : weekend ? 'bg-gray-100' : 'bg-white'
                  return (
                    <div
                      key={day}
                      className={`flex-shrink-0 border-r border-gray-100 ${bg} ${
                        isToday ? 'ring-1 ring-inset ring-blue-400' : ''
                      }`}
                      style={{ width: CELL_W }}
                      title={
                        holiday
                          ? `${holiday.name} · ${WEEKDAY_SHORT[wd]} ${day}.${monthIdx + 1}.`
                          : `${WEEKDAY_SHORT[wd]} ${day}.${monthIdx + 1}.`
                      }
                    />
                  )
                })}

                {/* Absence bars — one lane per person, stacked over the day cells */}
                {segs.map((s, i) => {
                  const c = personColor(s.personId)
                  const lane = laneOf[s.personId] ?? 0
                  const hovered = hoveredPersonId === s.personId
                  const span = s.endDay - s.startDay + 1
                  const roundCls =
                    (s.openStart ? 'rounded-l-none border-l-0 ' : '') +
                    (s.openEnd ? 'rounded-r-none border-r-0 ' : '')
                  return (
                    <div
                      key={`${s.personId}-${s.absenceId}-${i}`}
                      className={`absolute flex items-center justify-center overflow-hidden rounded-sm border ${c.bar} ${c.border} ${roundCls} ${
                        hovered ? `ring-2 ${c.ring} z-20 brightness-105 scale-[1.08]` : 'z-10'
                      } transition-transform`}
                      style={{
                        left: `calc(${s.startDay - 1} * ${CELL_W})`,
                        width: `calc(${span} * ${CELL_W})`,
                        top: `calc(${lane * laneHpct}% + 1px)`,
                        height: `calc(${laneHpct}% - 2px)`,
                      }}
                      title={`${s.personName} · ${TYPE_LABELS[s.type]} (${STATUS_LABELS[s.status]}) · ${fmtDe(s.absStart)} – ${fmtDe(s.absEnd)}`}
                      onMouseEnter={() => setHoveredPersonId(s.personId)}
                      onMouseLeave={() => setHoveredPersonId(null)}
                    >
                      {showLabels && span >= 2 && (
                        <span className="text-[9px] font-semibold leading-none text-gray-700 select-none pointer-events-none">
                          {TYPE_SHORT[s.type]}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
