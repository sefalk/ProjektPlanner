import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, LocateFixed } from 'lucide-react'
import type { YearHoliday, YearCalendarPerson } from '../../api'
import { TYPE_SHORT, TYPE_LABELS, STATUS_LABELS, personColor } from '../../lib/absenceColors'
import { computeAbsenceSegments } from '../../lib/absenceSegments'
import { regionKey, regionShade } from '../../lib/holidayRegions'

// ─── Layout constants ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const DAY_COLS = 31
const CELL_W = '2rem'       // ~+25% vs. the previous 1.6rem
const LABEL_W = '5.5rem'
const YEAR_W = '1.75rem'
const ROW_H = '2.75rem'
const ROW_PX = 44

// Diagonal hatch for out-of-month placeholder cells — clearly visible grey.
const HATCH: React.CSSProperties = {
  backgroundColor: '#eceef1',
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(100,116,139,0.35) 0, rgba(100,116,139,0.35) 1px, transparent 1px, transparent 5px)',
}

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

interface DragState {
  year: number
  monthIdx: number
  anchorDay: number
  currentDay: number
  personId: number | null
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function YearCalendar({
  years,
  holidaysByYear,
  persons,
  displayedRegions,
  onRangeSelect,
}: {
  years: number[]
  holidaysByYear: Record<number, YearHoliday[]>
  persons: YearCalendarPerson[]
  displayedRegions?: Set<string>
  onRangeSelect?: (personId: number | null, startISO: string, endISO: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentRowRef = useRef<HTMLDivElement>(null)
  const [hoveredPersonId, setHoveredPersonId] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const today = new Date()
  const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate())
  const curYear = today.getFullYear()
  const curMonth = today.getMonth()

  // Holidays across all years, grouped by ISO date, filtered to shown regions.
  const holidaysByDate = useMemo(() => {
    const map: Record<string, YearHoliday[]> = {}
    for (const y of years) {
      for (const h of holidaysByYear[y] ?? []) {
        if (displayedRegions && !displayedRegions.has(regionKey(h.country, h.state))) continue
        (map[h.holiday_date] ??= []).push(h)
      }
    }
    return map
  }, [years, holidaysByYear, displayedRegions])

  // One lane per passed-in (selected) person. Segments per year.
  const { segmentsByYearMonth, laneOf, laneOrder, laneCount } = useMemo(() => {
    const lane: Record<number, number> = {}
    const order: number[] = []
    for (const p of persons) {
      if (lane[p.id] !== undefined) continue
      lane[p.id] = order.length
      order.push(p.id)
    }
    const byYM: Record<string, ReturnType<typeof computeAbsenceSegments>> = {}
    for (const y of years) {
      for (const s of computeAbsenceSegments(persons, y)) {
        (byYM[`${y}-${s.monthIdx}`] ??= []).push(s)
      }
    }
    return { segmentsByYearMonth: byYM, laneOf: lane, laneOrder: order, laneCount: order.length }
  }, [persons, years])

  const laneHpct = laneCount > 0 ? 100 / laneCount : 100
  const laneHpx = laneCount > 0 ? ROW_PX / laneCount : ROW_PX
  const showLabels = laneHpx >= 11

  const dayNumbers = Array.from({ length: DAY_COLS }, (_, i) => i + 1)

  // Center the current month on mount / when the year range changes.
  useEffect(() => {
    const container = scrollRef.current
    const row = currentRowRef.current
    if (!container || !row) return
    container.scrollTop = Math.max(0, row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2)
  }, [years])

  function scrollBy(rows: number) {
    scrollRef.current?.scrollBy({ top: rows * ROW_PX, behavior: 'smooth' })
  }
  function recenter() {
    const container = scrollRef.current
    const row = currentRowRef.current
    if (!container || !row) return
    container.scrollTo({ top: Math.max(0, row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2), behavior: 'smooth' })
  }

  // ── Drag-to-create ──────────────────────────────────────────────────────
  const dragRef = useRef<DragState | null>(null)
  const rangeCbRef = useRef(onRangeSelect)
  rangeCbRef.current = onRangeSelect

  function updateDrag(d: DragState | null) { dragRef.current = d; setDrag(d) }
  function dayFromX(e: React.MouseEvent, numDays: number): number {
    const rect = e.currentTarget.getBoundingClientRect()
    const idx = Math.floor((e.clientX - rect.left) / (rect.width / DAY_COLS))
    return Math.min(numDays, Math.max(1, idx + 1))
  }
  function personFromY(e: React.MouseEvent): number | null {
    if (laneCount === 0) return null
    const rect = e.currentTarget.getBoundingClientRect()
    let lane = Math.floor((e.clientY - rect.top) / (rect.height / laneCount))
    lane = Math.max(0, Math.min(laneCount - 1, lane))
    return laneOrder[lane] ?? null
  }
  function onAreaMouseDown(e: React.MouseEvent, year: number, monthIdx: number, numDays: number) {
    if (!onRangeSelect) return
    const day = dayFromX(e, numDays)
    updateDrag({ year, monthIdx, anchorDay: day, currentDay: day, personId: personFromY(e) })
    e.preventDefault()
  }
  function onAreaMouseMove(e: React.MouseEvent, year: number, monthIdx: number, numDays: number) {
    const d = dragRef.current
    if (!d || d.monthIdx !== monthIdx || d.year !== year) return
    const day = dayFromX(e, numDays)
    if (day !== d.currentDay) updateDrag({ ...d, currentDay: day })
  }
  useEffect(() => {
    function finish() {
      const d = dragRef.current
      if (!d) return
      const cb = rangeCbRef.current
      updateDrag(null)
      if (!cb) return
      const lo = Math.min(d.anchorDay, d.currentDay)
      const hi = Math.max(d.anchorDay, d.currentDay)
      cb(d.personId, isoDate(d.year, d.monthIdx, lo), isoDate(d.year, d.monthIdx, hi))
    }
    window.addEventListener('mouseup', finish)
    return () => window.removeEventListener('mouseup', finish)
  }, [])

  // ── A single month row (label + day cells + bars) ────────────────────────
  function MonthRow({ year, monthIdx }: { year: number; monthIdx: number }) {
    const numDays = daysInMonth(year, monthIdx)
    const isCurrent = year === curYear && monthIdx === curMonth
    const segs = segmentsByYearMonth[`${year}-${monthIdx}`] ?? []
    return (
      <div
        ref={isCurrent ? currentRowRef : undefined}
        className={`flex border-b border-gray-100 ${isCurrent ? 'bg-blue-50/40' : ''}`}
      >
        <div
          className={`sticky z-10 flex-shrink-0 flex items-center border-r border-gray-200 px-2 font-medium ${
            isCurrent ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600'
          }`}
          style={{ left: YEAR_W, width: LABEL_W, height: ROW_H }}
        >
          {MONTH_NAMES[monthIdx]}
        </div>
        <div
          className={`relative flex ${onRangeSelect ? 'cursor-crosshair select-none' : ''}`}
          style={{ height: ROW_H }}
          onMouseDown={(e) => onAreaMouseDown(e, year, monthIdx, numDays)}
          onMouseMove={(e) => onAreaMouseMove(e, year, monthIdx, numDays)}
        >
          {dayNumbers.map((day) => {
            if (day > numDays) {
              return <div key={day} className="flex-shrink-0 border-r border-gray-100" style={{ width: CELL_W, ...HATCH }} aria-hidden="true" />
            }
            const dateStr = isoDate(year, monthIdx, day)
            const dayHolidays = holidaysByDate[dateStr]
            const weekend = isWeekend(year, monthIdx, day)
            const isToday = dateStr === todayStr
            const wd = weekdayIndex(year, monthIdx, day)
            const bg = dayHolidays
              ? regionShade(regionKey(dayHolidays[0].country, dayHolidays[0].state))
              : weekend ? 'bg-gray-100' : 'bg-white'
            const title = dayHolidays
              ? dayHolidays.map((h) => `${h.name} (${h.state})`).join(', ') + ` · ${WEEKDAY_SHORT[wd]} ${day}.${monthIdx + 1}.`
              : `${WEEKDAY_SHORT[wd]} ${day}.${monthIdx + 1}.`
            return (
              <div
                key={day}
                className={`flex-shrink-0 border-r border-gray-100 ${bg} ${isToday ? 'ring-1 ring-inset ring-blue-400' : ''}`}
                style={{ width: CELL_W }}
                title={title}
              />
            )
          })}

          {segs.map((s, i) => {
            const c = personColor(s.personId)
            const lane = laneOf[s.personId] ?? 0
            const hovered = hoveredPersonId === s.personId
            const span = s.endDay - s.startDay + 1
            const roundCls = (s.openStart ? 'rounded-l-none border-l-0 ' : '') + (s.openEnd ? 'rounded-r-none border-r-0 ' : '')
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
                  <span className="text-[9px] font-semibold leading-none text-gray-700 select-none pointer-events-none">{TYPE_SHORT[s.type]}</span>
                )}
              </div>
            )
          })}

          {drag && drag.year === year && drag.monthIdx === monthIdx && (() => {
            const lo = Math.min(drag.anchorDay, drag.currentDay)
            const hi = Math.max(drag.anchorDay, drag.currentDay)
            return (
              <div
                className="absolute top-0 bottom-0 z-30 bg-blue-400/20 border border-blue-500 pointer-events-none"
                style={{ left: `calc(${lo - 1} * ${CELL_W})`, width: `calc(${hi - lo + 1} * ${CELL_W})` }}
              />
            )
          })()}
        </div>
      </div>
    )
  }

  const scrollBtn = 'p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-100'

  return (
    <div className="flex gap-1">
      <div
        ref={scrollRef}
        className="overflow-auto rounded-lg border border-gray-200 bg-white max-h-[70vh] flex-1"
        aria-label="Jahreskalender"
      >
        <div className="inline-block min-w-full text-xs">
          {/* Header: day numbers */}
          <div className="flex sticky top-0 z-30 bg-gray-50 border-b border-gray-200">
            <div className="sticky left-0 z-40 bg-gray-50 flex-shrink-0 border-r border-gray-200" style={{ width: YEAR_W }} />
            <div className="sticky z-40 bg-gray-50 flex-shrink-0 border-r border-gray-200 px-2 py-1 font-semibold text-gray-500 uppercase tracking-wide" style={{ left: YEAR_W, width: LABEL_W }}>
              Monat
            </div>
            {dayNumbers.map((d) => (
              <div key={d} className="flex-shrink-0 text-center py-1 text-[10px] font-medium text-gray-400 border-r border-gray-100" style={{ width: CELL_W }}>
                {d}
              </div>
            ))}
          </div>

          {/* Year groups */}
          {years.map((year) => (
            <div key={year} className="flex">
              <div
                className="sticky left-0 z-20 flex-shrink-0 flex items-center justify-center bg-gray-50 border-r border-gray-200 font-semibold text-gray-500"
                style={{ width: YEAR_W, writingMode: 'vertical-rl' }}
              >
                {year}
              </div>
              <div className="flex flex-col">
                {MONTH_NAMES.map((_, monthIdx) => (
                  <MonthRow key={monthIdx} year={year} monthIdx={monthIdx} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll controls */}
      <div className="flex flex-col justify-center gap-1">
        <button onClick={() => scrollBy(-12)} className={scrollBtn} title="Ein Jahr zurück" aria-label="Ein Jahr zurück"><ChevronsUp size={15} /></button>
        <button onClick={() => scrollBy(-1)} className={scrollBtn} title="Ein Monat zurück" aria-label="Ein Monat zurück"><ChevronUp size={15} /></button>
        <button onClick={recenter} className={scrollBtn} title="Zum aktuellen Monat" aria-label="Zum aktuellen Monat"><LocateFixed size={14} /></button>
        <button onClick={() => scrollBy(1)} className={scrollBtn} title="Ein Monat vor" aria-label="Ein Monat vor"><ChevronDown size={15} /></button>
        <button onClick={() => scrollBy(12)} className={scrollBtn} title="Ein Jahr vor" aria-label="Ein Jahr vor"><ChevronsDown size={15} /></button>
      </div>
    </div>
  )
}
