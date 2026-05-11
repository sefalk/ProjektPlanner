# v0.6 — Calendar Enhancements

_Status: ✅ implemented on dev_
_Source: Review v0.1.0 (23.04.2026) — III_

## Context

The calendar page exists as a month resource grid. The review requests it become the central visual hub:
- Dynamic width filling the browser window
- Per-project utilization bars (height relative to allocation)
- Filters for Hauptprojekte / Einzelprojekte
- Milestone info visible in calendar (hover tooltip)
- Forecast chart below the grid (Volles Budget / PLAN / Aktuell / Prognose)

## Changes

### 1. Dynamic width
**File:** `frontend/src/pages/CalendarPage.tsx`

Remove any fixed `w-[Npx]` constraint on the grid wrapper.
Use `min-w-max w-full` on the inner grid so it fills available width without wrapping cells.
Outer container keeps `overflow-x-auto` + minimum sensible width.

### 2. Per-project utilization bars
**File:** `frontend/src/pages/CalendarPage.tsx`

For each person row, render one horizontal bar per active project in the month.
Bar height is proportional to `membership.weekly_capacity_hours / person.default_weekly_hours`.
Two projects at 50% each stack to fill the full row height.

Requires `weekly_capacity_hours` in the calendar API response:

**File:** `backend/app/routers/calendar.py`
Add `weekly_capacity_hours: float` to the `CalendarMembership` response object.

**File:** `frontend/src/api.ts`
Add `weekly_capacity_hours: number` to `CalendarMembership`.

### 3. Filters
**File:** `frontend/src/pages/CalendarPage.tsx`

Filter state: `selectedProgramId: number | null`, `selectedProjectIds: number[]`

- Dropdown "Alle Hauptprojekte" → filters to program's projects
- Multi-chip "Projekte" → specific project filter
- When active: hide persons with no membership in selected project(s)
- Requires `programs.list()` query in CalendarPage

### 4. Milestone tooltip
**File:** `frontend/src/pages/CalendarPage.tsx`

Extend the existing milestone dot on the month header: on hover, show tooltip with `status`, `current_hours`, `initial_hours` for each project that month.

**File:** `backend/app/routers/calendar.py`
Add `current_hours: float` and `initial_hours: float` to the `CalendarMilestone` response.

**File:** `frontend/src/api.ts`
Update `CalendarMilestone` with `current_hours`, `initial_hours`.

### 5. Forecast chart
**File:** `frontend/src/pages/CalendarPage.tsx`

Chart shown below the grid when a specific project is selected via filter.
Uses `recharts` (add to `frontend/package.json`).

X-axis: months (project start → end)

Four series:
| Series | Source |
|---|---|
| **Volles Budget** | flat line at `project.total_budget_hours` |
| **PLAN (INIT)** | cumulative `initial_hours` per month from `projects.milestones()` |
| **Aktuell** | cumulative `current_hours` per month from `projects.milestones()` |
| **Prognose** | cumulative: actual up to today + `suggested_hours` (from `projects.suggestions()`) for future months |

Note: PLAN may not reach Volles Budget if milestones were initialized conservatively.

## Review items addressed

- III.1 — Kalender als zentrale Hauptseite (already done in v0.2: first nav item)
- III.3 — Dynamische Kalenderbreite bis zur Browserbreite
- III.4 — Horizontale Balken pro Projekt pro Person, Höhe relativ zur Auslastung
- III.5 — Filter für Hauptprojekte und Einzelprojekte; unbeteiligte Personen ausblenden
- III.6 — Projektmeilenstein-Information im Kalender (Hover-Tooltip)
- III.7 — Chart mit Meilenstein-Übersicht: Volles Budget / PLAN / Aktuell / Prognose

## Deferred from review

- III.2 — Interaktive Kalendereinträge editieren: Low priority; risk of over-engineering. Limit to "click absence → navigate to person detail".

## Verification

1. Resize browser window → grid fills width without artifacts
2. Person at 50% on one project → bar covers half row height
3. Filter by project → unrelated persons disappear
4. Hover milestone dot → tooltip shows planned vs current hours
5. Select project → chart appears with all 4 series; PLAN does not necessarily reach Volles Budget line
