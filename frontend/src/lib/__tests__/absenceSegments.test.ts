import { describe, it, expect } from 'vitest'
import { computeAbsenceSegments } from '../absenceSegments'
import type { YearCalendarPerson } from '../../api'

function person(absences: YearCalendarPerson['absences']): YearCalendarPerson {
  return { id: 1, name: 'P', default_weekly_hours: 40, holiday_country: 'DE', holiday_state: 'BY', absences, memberships: [] }
}

function abs(start: string, end: string | null, type: 'vacation' | 'sick' | 'training' = 'vacation') {
  return { id: 1, start_date: start, end_date: end, absence_type: type, status: 'confirmed' as const }
}

describe('computeAbsenceSegments', () => {
  it('keeps a single-month absence as one closed segment', () => {
    const segs = computeAbsenceSegments([person([abs('2026-05-04', '2026-05-08')])], 2026)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ monthIdx: 4, startDay: 4, endDay: 8, openStart: false, openEnd: false })
  })

  it('splits a month-spanning absence and flags the break edges as open', () => {
    const segs = computeAbsenceSegments([person([abs('2026-09-21', '2026-10-04')])], 2026)
    expect(segs).toHaveLength(2)
    const [sep, oct] = segs
    expect(sep).toMatchObject({ monthIdx: 8, startDay: 21, endDay: 30, openStart: false, openEnd: true })
    expect(oct).toMatchObject({ monthIdx: 9, startDay: 1, endDay: 4, openStart: true, openEnd: false })
  })

  it('marks the December segment open when the absence runs into the next year', () => {
    const segs = computeAbsenceSegments([person([abs('2026-12-24', '2027-01-09')])], 2026)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ monthIdx: 11, startDay: 24, endDay: 31, openEnd: true })
  })

  it('marks the January segment open when the absence started in the previous year', () => {
    const segs = computeAbsenceSegments([person([abs('2025-12-28', '2026-01-05')])], 2026)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ monthIdx: 0, startDay: 1, endDay: 5, openStart: true, openEnd: false })
  })

  it('treats an ongoing (null end) absence as running to year end, open at the tail', () => {
    const segs = computeAbsenceSegments([person([abs('2026-11-15', null, 'sick')])], 2026)
    // Nov (open end) + Dec (open both ends)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ monthIdx: 10, startDay: 15, openEnd: true })
    expect(segs[1]).toMatchObject({ monthIdx: 11, endDay: 31, openStart: true, openEnd: true })
  })

  it('excludes absences that do not overlap the year', () => {
    const segs = computeAbsenceSegments([person([abs('2025-03-01', '2025-03-05')])], 2026)
    expect(segs).toHaveLength(0)
  })
})
