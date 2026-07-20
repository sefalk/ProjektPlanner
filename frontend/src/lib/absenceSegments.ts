// Split each person's absences into per-month segments for the year calendar.
//
// A single absence that spans several months yields one segment per month, each
// flagged openStart/openEnd when it continues across a month (or year) boundary
// so the UI can draw an "open" edge at the break.

import type { YearCalendarPerson, CalendarAbsence } from '../api'

type AbsenceType = CalendarAbsence['absence_type']
type AbsenceStatus = CalendarAbsence['status']

export interface AbsenceSegment {
  personId: number
  personName: string
  absenceId: number
  type: AbsenceType
  status: AbsenceStatus
  monthIdx: number // 0-11
  startDay: number // 1-based, inclusive
  endDay: number // 1-based, inclusive
  openStart: boolean // continues from a previous month / before the year
  openEnd: boolean // continues into a following month / past the year
  /** full absence range for tooltips (ISO, end null = ongoing) */
  absStart: string
  absEnd: string | null
  /** backend-computed booking metrics (see planning.absence_booking) */
  bookedWorkingDays: number | null
  bookedHours: number | null
  contingentDays: number | null
}

interface YMD {
  y: number
  m: number // 0-based
  d: number
}

function parse(s: string): YMD {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** comparable integer YYYYMMDD */
function ord(v: YMD): number {
  return v.y * 10000 + v.m * 100 + v.d
}

function daysInMonth(year: number, monthIdx: number): number {
  return new Date(year, monthIdx + 1, 0).getDate()
}

export function computeAbsenceSegments(
  persons: YearCalendarPerson[],
  year: number,
): AbsenceSegment[] {
  const yearStart: YMD = { y: year, m: 0, d: 1 }
  const yearEnd: YMD = { y: year, m: 11, d: 31 }
  const segments: AbsenceSegment[] = []

  for (const person of persons) {
    for (const a of person.absences) {
      const absStart = parse(a.start_date)
      // Ongoing (null end) or beyond-year end → clamp to year end, mark open.
      const absEndParsed = a.end_date ? parse(a.end_date) : null
      const extendsBeforeYear = ord(absStart) < ord(yearStart)
      const extendsAfterYear = absEndParsed === null || ord(absEndParsed) > ord(yearEnd)

      const clampedStart = ord(absStart) < ord(yearStart) ? yearStart : absStart
      const clampedEnd =
        absEndParsed === null || ord(absEndParsed) > ord(yearEnd) ? yearEnd : absEndParsed

      // No overlap with this year.
      if (ord(clampedStart) > ord(clampedEnd)) continue

      const firstMonth = clampedStart.m
      const lastMonth = clampedEnd.m

      for (let m = firstMonth; m <= lastMonth; m++) {
        const startDay = m === firstMonth ? clampedStart.d : 1
        const endDay = m === lastMonth ? clampedEnd.d : daysInMonth(year, m)
        segments.push({
          personId: person.id,
          personName: person.name,
          absenceId: a.id,
          type: a.absence_type,
          status: a.status,
          monthIdx: m,
          startDay,
          endDay,
          openStart: m > firstMonth || extendsBeforeYear,
          openEnd: m < lastMonth || extendsAfterYear,
          absStart: a.start_date,
          absEnd: a.end_date,
          bookedWorkingDays: a.booked_working_days ?? null,
          bookedHours: a.booked_hours ?? null,
          contingentDays: a.contingent_days ?? null,
        })
      }
    }
  }

  return segments
}
