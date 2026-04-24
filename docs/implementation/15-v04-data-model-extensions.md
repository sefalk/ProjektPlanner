# v0.4 — Data Model Extensions

_Status: ✅ implemented on dev_
_Source: Review v0.1.0 (23.04.2026) — I.6 + II.3/4/5 + Allgemein §2_

## Context

Four gaps in the current data model:

1. **Budget €**: Projects have `total_budget_hours` but no € figure. Per the review, the € budget is the primary binding constraint — hours are derived from agreed rates.
2. **Daily work week pattern**: Persons have only `default_weekly_hours` (e.g. 40). But patterns like 8-8-8-8-0 (4-day week) or 7-7-7-7-4 need to be representable for correct milestone math.
3. **Default billing rate**: No default rate on Person means it must be entered manually every time a project membership is created.
4. **Default vacation days**: Currently fixed at whatever is entered. 30 days/year should be the default, configurable globally.

All changes are additive (nullable columns). One Alembic migration covers items 1–3.

## Changes

### 1. Budget € on Project
**File:** `backend/app/models/project.py`
```python
total_budget_euros: float | None = None
```
Both `total_budget_hours` and `total_budget_euros` coexist. Budget € is the contract limit; hours are the planning unit.

**Files:** `frontend/src/api.ts`, `frontend/src/pages/ProjectsPage.tsx` (form), `frontend/src/pages/ProjectDetailPage.tsx` (display)

### 2. Daily work week pattern on Person
**File:** `backend/app/models/person.py`
```python
work_week_pattern: str | None = None
```
Encoding: 5 comma-separated integers = hours per weekday Mon–Fri.
Examples: `"8,8,8,8,8"` = standard 40h; `"8,8,8,8,0"` = 4-day 32h; `"7,7,7,7,4"` = 32h reduced Friday.

`default_weekly_hours` is kept — it equals `sum(pattern)` when a pattern is set, or is standalone if not.

**File:** `backend/app/services/planning.py`
Modify `_person_hours_in_month()`: when `work_week_pattern` is set, iterate actual calendar days in the month and sum `pattern[weekday]` (Mon=0…Fri=4) scaled by `capacity / sum(pattern)`.

**Files:** `frontend/src/api.ts`, `frontend/src/pages/PersonsPage.tsx` (dropdown: standard / 4-Tage / custom)

### 3. Default billing rate on Person
**File:** `backend/app/models/person.py`
```python
default_billing_rate: float | None = None
```
**File:** `frontend/src/pages/ProjectDetailPage.tsx` — when a person is selected in the "Mitglied hinzufügen" form, pre-fill `billing_rate_per_hour` from `person.default_billing_rate`.

### 4. Default vacation days + Settings page
**File:** `backend/app/models/setting.py` (new)
```python
class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
```
Pre-populated: `default_vacation_days = "30"`.

**File:** `backend/app/routers/settings.py` (new)
- `GET /settings` → `{key: value}` dict
- `PUT /settings/{key}` → update

**File:** `backend/app/routers/persons.py`
Auto-create vacation contingent for current year on person creation, using `default_vacation_days` setting.

**Files:** `frontend/src/pages/SettingsPage.tsx` (new), `frontend/src/App.tsx` (gear icon nav link + `/settings` route)

## Migration
Single Alembic migration adds:
- `project.total_budget_euros` (Float, nullable)
- `person.work_week_pattern` (String, nullable)
- `person.default_billing_rate` (Float, nullable)
- `setting` table (new)

## Review items addressed

- I.6 — Budget € als primäre Größe neben Planstunden
- II.3 — Default-Stundensatz auf Person (in Projekten überschreibbar)
- II.4 — Standard 30 Urlaubstage pro Person/Jahr
- II.5 — Individuelle Wochenmodelle (8-8-8-8-8, 8-8-8-8-0, 7-7-7-7-4)
- Allgemein §2 — Settings-Seite für globale Einstellungen

## Verification

1. Create person with `work_week_pattern="8,8,8,8,0"` → milestone init produces 32h/week capacity
2. Create project with `total_budget_euros=50000` → shown in detail view
3. Settings page → change default vacation days to 25 → create new person → contingent auto-created with 25 days
4. Add membership → billing rate pre-filled from person default
