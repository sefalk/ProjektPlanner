# v0.5 — Milestone Table Enhancements

_Status: ✅ implemented on dev_
_Source: Review v0.1.0 (23.04.2026) — I.8_
_Depends on: v0.4 (daily work week pattern, € budget)_

## Context

The milestone table shows one aggregated row per month. The review requests:

- **Per-person breakdown** as expandable rows (with Arbeitstage / Urlaubstage / Feiertage counts)
- **Improved initialization**: deduct public holidays (from `Holiday` table) and personal absences/vacation from available hours. When no specific vacation is entered, distribute remaining vacation contingent evenly across remaining project months.
- **Rename "Aktuell"** column + add **auto-rebalanced** projection column
- **Inline editing** of per-person hours in milestone rows
- **Sum row** across all milestones
- **Budget (€) consumed** column

## Changes

### 1. Improved milestone initialization
**File:** `backend/app/services/milestones.py`

Replace `working_days × (capacity / 5)` with:

```python
def _person_available_hours(person, membership, year, month, session):
    # 1. List working days in month (Mon–Fri, not a holiday for project's country/state)
    # 2. For each working day: determine daily hours from work_week_pattern (if set)
    #    else capacity / working_days_per_week
    # 3. Subtract specific absence days (PersonAbsence entries overlapping this month)
    # 4. If no specific vacation this month, distribute remaining contingent:
    #    remaining_days / remaining_project_months → fractional deduction
```

Vacation distribution formula:
- `taken_before = count vacation absences for person before this month`
- `remaining = contingent.total_days - taken_before`
- `remaining_months = project months from this month to project end`
- `deduct = remaining / remaining_months` (apply as fractional day reduction)

### 2. New detail endpoint
**File:** `backend/app/routers/projects.py`

Add `GET /projects/{id}/milestones/detail` returning:
```json
[{
  "milestone": { "id": ..., "year": ..., "month": ..., "initial_hours": ..., "current_hours": ..., "status": ... },
  "persons": [{
    "person_id": 1, "person_name": "Anna Bauer",
    "initial_hours": 80.0, "current_hours": 76.0,
    "work_days": 21, "absence_days": 2, "holiday_days": 1
  }]
}]
```

**File:** `frontend/src/api.ts` — add `MilestoneDetail` + `MilestonePersonDetail` types and `projects.milestonesDetail(id)` call.

### 3. `PUT /milestones/{id}/persons/{person_id}` — edit per-person hours
**File:** `backend/app/routers/projects.py` or new `backend/app/routers/milestones.py`

Updates `MilestonePersonBudget.current_hours`. Recalculates `Milestone.current_hours = SUM(person budgets)`.

### 4. Updated milestone table (frontend)
**File:** `frontend/src/pages/ProjectDetailPage.tsx`

- Rename "Aktuell" header → "Aktuell (angepasst)"
- Add "Rebalanciert" column: shows `suggested_hours` from `projects.suggestions()` per milestone
- Add expand toggle (chevron) per milestone row
  - When expanded: sub-rows per person with name, initial h, current h, work days, absence days, holiday days
  - Each person sub-row has pencil icon → inline edit modal for `current_hours`
- Footer row: sum of initial / current / rebalanced hours across all milestones
- "Budget verbraucht (€)" column: `SUM(current_hours × billing_rate_per_hour)` per milestone
- "Abschließen" button per open milestone row (direct close without needing invoice tab)

## Review items addressed

- I.8 — Meilenstein-Aufschlüsselung pro Person (expandierbare Zeilen)
- I.8 — Personenaufschlüsselung: Arbeitstage, Urlaubs- und Fortbildungstage
- I.8 — Initialisierung berücksichtigt Feiertage und persönliche Abwesenheiten
- I.8 — Gleichmäßige Urlaubsverteilung über Projektlaufzeit wenn kein spezifischer Urlaub eingetragen
- I.8 — Spalte "Aktuell" umbenennen
- I.8 — Auto-rebalanced Spalte (Differenz zum AKTUELL, um Budget voll auszureizen)
- I.8 — Editierbutton für "Aktuell" auf Personenebene
- I.8 — Anzeige der Summe über alle Meilensteine
- I.8 — Budget (€) verbraucht in Meilenstein-Tabelle

## Verification

1. Project in April 2026 (Bayern): Karfreitag + Ostermontag reduce available hours
2. Person with 5 vacation days specific to April → exactly those days deducted
3. Person with 30 vacation days, no specific entries, 6-month project → 5 days distributed per month
4. Expand milestone row → per-person sub-rows with correct counts
5. Edit person hours → sum row updates, milestone total updates
6. "Rebalanciert" column sums to remaining budget over open milestones
