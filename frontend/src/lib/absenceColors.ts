// Shared absence label/color maps and per-person color palette.
//
// Single source of truth for what used to be duplicated in PersonDetailPage
// (TYPE_LABELS / TYPE_COLORS / STATUS_LABELS) and CalendarPage
// (ABSENCE_BG / ABSENCE_LABEL / ABSENCE_NAME / STATUS_NAME).
//
// NOTE: Tailwind's JIT only picks up class names that appear verbatim, so the
// palette below enumerates every variant statically — do not build class names
// by string concatenation.

import type { PersonAbsence } from '../api'

type AbsenceType = PersonAbsence['absence_type'] // 'vacation' | 'sick' | 'training'
type AbsenceStatus = PersonAbsence['status'] // 'planned' | 'confirmed' | 'ongoing'

/** Long German labels (Urlaub / Krank / Fortbildung). */
export const TYPE_LABELS: Record<AbsenceType, string> = {
  vacation: 'Urlaub',
  sick: 'Krank',
  training: 'Fortbildung',
}

/** Single-letter codes for compact inline tags (U / K / F). */
export const TYPE_SHORT: Record<AbsenceType, string> = {
  vacation: 'U',
  sick: 'K',
  training: 'F',
}

/** Light badge classes (bg + text) — tables, legends, chips. */
export const TYPE_BADGE: Record<AbsenceType, string> = {
  vacation: 'bg-blue-100 text-blue-700',
  sick: 'bg-yellow-100 text-yellow-700',
  training: 'bg-emerald-100 text-emerald-700',
}

/** Stronger fill classes — per-day overlays / bars in the month calendar. */
export const TYPE_BAR_BG: Record<AbsenceType, string> = {
  vacation: 'bg-blue-200',
  sick: 'bg-yellow-200',
  training: 'bg-emerald-200',
}

export const STATUS_LABELS: Record<AbsenceStatus, string> = {
  planned: 'Geplant',
  confirmed: 'Bestätigt',
  ongoing: 'Laufend',
}

// ─── Per-person color palette ──────────────────────────────────────────────
//
// Each person is assigned one entry deterministically by id, used identically
// in the year-calendar bars and the person table so the two views harmonize.
// Reds are reserved for holidays and grays for weekends / deselected rows, so
// those hues are excluded here.

export interface PersonColor {
  /** solid swatch — table legend dot */
  dot: string
  /** semi-transparent bar body */
  bar: string
  /** solid bar (e.g. hover-emphasized) */
  barSolid: string
  /** border color — hover highlight */
  border: string
  /** light row tint — table row background when selected */
  rowBg: string
  /** readable text color on light backgrounds */
  text: string
}

export const PERSON_PALETTE: PersonColor[] = [
  { dot: 'bg-sky-500', bar: 'bg-sky-400/30', barSolid: 'bg-sky-400', border: 'border-sky-500', rowBg: 'bg-sky-50', text: 'text-sky-700' },
  { dot: 'bg-violet-500', bar: 'bg-violet-400/30', barSolid: 'bg-violet-400', border: 'border-violet-500', rowBg: 'bg-violet-50', text: 'text-violet-700' },
  { dot: 'bg-amber-500', bar: 'bg-amber-400/30', barSolid: 'bg-amber-400', border: 'border-amber-500', rowBg: 'bg-amber-50', text: 'text-amber-700' },
  { dot: 'bg-teal-500', bar: 'bg-teal-400/30', barSolid: 'bg-teal-400', border: 'border-teal-500', rowBg: 'bg-teal-50', text: 'text-teal-700' },
  { dot: 'bg-pink-500', bar: 'bg-pink-400/30', barSolid: 'bg-pink-400', border: 'border-pink-500', rowBg: 'bg-pink-50', text: 'text-pink-700' },
  { dot: 'bg-lime-500', bar: 'bg-lime-400/30', barSolid: 'bg-lime-400', border: 'border-lime-500', rowBg: 'bg-lime-50', text: 'text-lime-700' },
  { dot: 'bg-indigo-500', bar: 'bg-indigo-400/30', barSolid: 'bg-indigo-400', border: 'border-indigo-500', rowBg: 'bg-indigo-50', text: 'text-indigo-700' },
  { dot: 'bg-orange-500', bar: 'bg-orange-400/30', barSolid: 'bg-orange-400', border: 'border-orange-500', rowBg: 'bg-orange-50', text: 'text-orange-700' },
  { dot: 'bg-cyan-500', bar: 'bg-cyan-400/30', barSolid: 'bg-cyan-400', border: 'border-cyan-500', rowBg: 'bg-cyan-50', text: 'text-cyan-700' },
  { dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-400/30', barSolid: 'bg-fuchsia-400', border: 'border-fuchsia-500', rowBg: 'bg-fuchsia-50', text: 'text-fuchsia-700' },
  { dot: 'bg-emerald-500', bar: 'bg-emerald-400/30', barSolid: 'bg-emerald-400', border: 'border-emerald-500', rowBg: 'bg-emerald-50', text: 'text-emerald-700' },
  { dot: 'bg-rose-500', bar: 'bg-rose-400/30', barSolid: 'bg-rose-400', border: 'border-rose-500', rowBg: 'bg-rose-50', text: 'text-rose-700' },
]

/** Deterministic per-person color (stable across views). */
export function personColor(personId: number): PersonColor {
  return PERSON_PALETTE[personId % PERSON_PALETTE.length]
}
