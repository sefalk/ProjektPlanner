# ProjektPlanner — Development Plan

_Last updated: 2026-04-22_

---

## Goal

Replace the per-project Excel workflow with a local web app that:
- Gives a unified overview of all projects (past and active, including parallel ones)
- Handles multiple persons per project with individual time ranges and billing rates
- Plans monthly milestones at project start, tracks drift vs. initial plan as reality changes
- Imports time bookings from Sage ERP (file/paste-based, no API)
- Tracks monthly invoicing per person with individual hourly rates and closes months for billing
- Is built locally-first but architected to scale to multi-user/deployed

---

## Data & Privacy Rules

- **No sensitive data in code.** Project numbers, person names, billing rates, invoice amounts — all live in the database only. Never hardcoded, never in fixtures committed to git.
- **Development uses pseudo data only.** Seed scripts use fake names, fake project numbers (e.g. "P00001"), fake rates. Real data never in the repo.
- **DSGVO scope:** Person names, hourly rates, booked hours, invoice amounts are personal/sensitive. The DB file must not be committed.
- `.gitignore` must exclude: `*.db`, `*.sqlite`, `seed/real/`, `.env`

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend | **FastAPI** (Python) | Familiar language, async-ready, clean REST API, easy to containerize |
| ORM | **SQLModel** | Combines SQLAlchemy + Pydantic, designed for FastAPI |
| Migrations | **Alembic** | Schema evolution for SQLite → PostgreSQL; auto-generates migration scripts |
| Database | **SQLite** (local) → **PostgreSQL** (multi-user) | Zero-config locally, connection-string swap to scale |
| Config | **python-dotenv / `.env` file** | DB path, API URLs, defaults — never hardcoded |
| Frontend | **React + Vite + TypeScript** | Standard, extensible ecosystem |
| UI Components | **shadcn/ui + Tailwind CSS** | Clean components, no vendor lock-in |
| Package managers | **uv** (Python) / **pnpm** (JS) | Fast, reproducible |
| Holiday data | **feiertage-api.de** | Free, no auth; cached in DB; fallback to OpenHolidays API |
| Testing | **pytest** (backend) / **Vitest** (frontend) | Unit tests mandatory for planning/availability engine |

**Project layout:**
```
ProjektPlanner/
  backend/
    app/
      models/         # SQLModel data models
      routers/        # API route handlers
      services/
        planning.py   # availability, milestone targets, rebalancing
        import_.py    # Sage file parsing, person matching
        holiday.py    # API fetch + cache management
        invoice.py    # month-close, invoice creation
      db.py
      main.py
    alembic/          # migration scripts
    seed/
      dev_data.py     # pseudo data only — NO real data
    tests/
    pyproject.toml
    .env.example      # committed; .env is NOT
  frontend/
    src/
      components/
      pages/
      api/            # typed API client (one module per resource)
    package.json
  docs/
  .venv/
  .gitignore
```

---

## Holiday API

- **Primary:** `GET https://feiertage-api.de/api/?jahr={year}&nur_land=BY`
- **Fallback:** OpenHolidays API (more countries/subdivisions)
- **Caching:** Fetched once per year/country/state combination; stored in `Holiday` table.
- **Failure handling:** If API unavailable and year not yet cached, the service raises a warning and the UI prompts the user to retry or enter holidays manually. Availability calculations block on missing holiday data rather than silently returning wrong results.
- Country + state configurable per project, default DE/BY.

---

## Core Concepts & Business Logic

### Planning flow

```
1. Project created → total_budget_hours set; BillingPositions define budget_euros
2. Persons assigned via ProjectMembership (capacity, billing rate, date range)
3. Milestones initialised (one per calendar month):
   - initial_hours per month based on expected capacity per active person
   - MilestonePersonBudget created for each active person in that month
   - Sum of MilestonePersonBudget.initial_hours = Milestone.initial_hours
   - May not sum exactly to total_budget_hours (reflects real-world uncertainty)
4. Project runs:
   - Absences added → availability changes → rebalancing suggested
   - Sage import → TimeBookings → actual hours → drift detected → rebalancing suggested
5. Month-end: user closes milestone → MonthlyInvoice created → milestone locked
```

### Availability calculation

```
available_days(person, start, end) =
    working_days(start, end)                     ← Mon–Fri, no calendar gaps
    − holidays(project.country, project.state)   ← Holiday table (must be cached)
    − PersonAbsences (vacation, training, confirmed sick)
    − estimated_unplanned_vacation               ← see below

capacity_hours_per_day(person, project) =
    ProjectMembership.weekly_capacity_hours / 5
```

**Holiday failure:** If the Holiday table has no entries for the required year/country/state, the API is called automatically. If that also fails, availability is flagged as "incomplete" and the UI shows a warning rather than silently computing with wrong data.

### Vacation contingent & estimation

`VacationContingent` stores the annual entitlement (e.g. 32 days/year). For future periods where vacation is not yet specifically planned:

```
estimated_unplanned_vacation(person, period_start, period_end) =
    (contingent_for_year − Σ PersonAbsence[vacation, in year])
    × (period_length_days / remaining_days_in_year)
```

Once a concrete `PersonAbsence` (status=planned/confirmed) covers a date, it replaces the estimate for that date. This formula only applies to dates with no concrete absence entry.

**Year boundary:** For projects spanning a calendar year boundary, the estimation is applied per-year segment using each year's contingent.

### Sick leave handling

`PersonAbsence` with `absence_type=sick`:
- **`status=ongoing`**: person is currently sick; `end_date` is either null (unknown) or an estimate
- **`status=confirmed`**: person has returned; `start_date` and `end_date` are final
- Each change (create, end_date update, confirmation) triggers a rebalancing suggestion on all open milestones that overlap the affected period.

### Milestone structure

One `Milestone` per calendar month per project. It is the **project-level** billing commitment for that month.

```
Milestone
  project_id, year, month
  initial_hours    -- set at project creation; immutable once any milestone is closed
  current_hours    -- updated by accepted rebalancing
  status           -- open | closed
  is_locked        -- true after close; unlock requires confirmation
```

`MilestonePersonBudget` holds the per-person split:
```
MilestonePersonBudget
  milestone_id, person_id
  initial_hours    -- immutable once parent milestone is closed
  current_hours    -- updated by rebalancing
```

**Invariant:** `Σ MilestonePersonBudget.current_hours == Milestone.current_hours` (enforced by service layer).

**Initial population:** Created automatically when a project is saved with all memberships defined. The service distributes `total_budget_hours` across months proportionally to each person's expected available capacity in that month.

### Rebalancing logic

Triggered automatically when: Sage import completes, sick leave created/modified/confirmed, milestone closed.

```
1. remaining_hours = total_budget_hours
                     − Σ closed_milestone.current_hours
                     − Σ TimeBooking.net_hours WHERE month is open

2. For each remaining open milestone month m:
   capacity(m) = Σ over active persons:
       available_days(person, m) × capacity_hours_per_day(person, project)

3. Distribute remaining_hours proportionally to capacity(m):
   suggested_hours(m) = remaining_hours × capacity(m) / Σ capacity

4. Within each milestone, split by person proportionally to their capacity(m).

5. Compute suggested_euros(m) = Σ suggested_person_hours × billing_rate_per_hour

6. If Σ suggested_euros(m) > remaining_budget_euros:
   → Flag conflict: "hours budget can be met but € budget would be exceeded"
   → Show both projections; hours take priority unless user overrides
   → User must resolve manually (reduce scope or accept overspend)

7. Present diff to user: suggested vs current per milestone + per person
   User accepts all / accepts per-milestone / edits manually
```

**Priority rule:** Hours budget is the primary constraint (it's the contract commitment). The euros check is advisory — it flags a financial risk but does not block the rebalancing suggestion.

### Month-end closing

1. User initiates "Close month" for a milestone
2. System checks: are there any `TimeBooking` entries dated within the month with an import date after the last known import? (If the last Sage import date precedes the last day of the month, a warning is shown: "Last import: {date}. Bookings after this date may be missing.")
3. `Milestone.status → closed`, `Milestone.is_locked = true`
4. `MonthlyInvoice` created with `status=planned`:
   - One `InvoicePersonEntry` per person: `hours = Σ TimeBooking.net_hours` for that person in that month; `amount = hours × billing_rate_per_hour`
   - `MonthlyInvoice.total_hours` and `total_amount_euros` = sum of entries
5. Rebalancing is triggered for all remaining open milestones
6. Closed + locked milestones display a padlock icon; "Unlock" requires a confirmation dialog and adds an audit note

---

## Data Model

### Hierarchy

```
Program
  └── Project
        ├── BillingPosition  (defines budget_euros; sum = project financial scope)
        ├── ProjectMembership  (person ↔ project: capacity, rate, date range)
        ├── Milestone ──► MilestonePersonBudget
        ├── MonthlyInvoice ──► InvoicePersonEntry
        └── TimeBooking  (FK to project + person; month derived from date)

Person
  ├── VacationContingent  (per year)
  └── PersonAbsence  (date ranges)

Holiday  (global cache, per country/state/year)
```

### Entities

```
Program
  id, program_number, name, customer

Project
  id, program_id (FK, nullable)
  project_number, name, description
  start_date, end_date
  total_budget_hours               -- planning constraint (hours)
  holiday_country, holiday_state   -- default "DE", "BY"
  status                           -- active | completed | archived
  NOTE: budget_euros is NOT stored on Project directly.
        Use SUM(BillingPosition.budget_euros) for the financial budget.
        This avoids the redundancy of two sources of truth.

Person
  id, name, sage_employee_name     -- sage_employee_name for Sage import matching
  default_weekly_hours

VacationContingent
  id, person_id, year, total_days

PersonAbsence                      -- date-range record (not per-day rows)
  id, person_id
  start_date
  end_date                         -- nullable only for sick with status=ongoing
  absence_type                     -- vacation | training | sick
  status                           -- vacation/training: planned | confirmed
                                   -- sick: ongoing | confirmed
                                   -- (enforced: vacation/training cannot be ongoing;
                                   --  sick cannot be planned)
  note

ProjectMembership
  id, project_id, person_id
  from_date, to_date
  weekly_capacity_hours
  billing_rate_per_hour            -- fixed for this contract period
  NOTE: no planned_hours field — that is derived from
        SUM(MilestonePersonBudget.initial_hours) for this person/project

BillingPosition                    -- PSP-Element / contract line item
  id, project_id
  position_number, description, budget_euros

Milestone                          -- one per calendar month, project-level
  id, project_id, year, month
  initial_hours                    -- immutable once any milestone in project is closed
  current_hours
  status                           -- open | closed
  is_locked                        -- set true on close; requires confirmation to unset

MilestonePersonBudget              -- per-person split; must sum to Milestone.current_hours
  id, milestone_id, person_id
  initial_hours
  current_hours

MonthlyInvoice                     -- created on milestone close
  id, project_id, billing_position_id, year, month
  total_hours, total_amount_euros
  status                           -- planned | invoiced | paid
  is_locked                        -- mirrors Milestone.is_locked (for invoice protection)

InvoicePersonEntry
  id, invoice_id, person_id
  hours, billing_rate_per_hour, amount_euros

TimeBooking                        -- raw Sage ERP import row
  id
  date, person_id, project_id      -- project_id required for routing to milestone
  sage_project_name, sage_project_level
  net_hours                        -- canonical hours field used in all calculations
  duration_raw, break_duration     -- stored as strings (display only; not used in calc)
  import_batch_id                  -- FK to ImportBatch; enables re-import detection
  UNIQUE(date, person_id, project_id, sage_project_level, net_hours)
                                   -- deduplication key; upsert uses this constraint

ImportBatch                        -- tracks each Sage import event
  id, imported_at, project_id
  source_filename (nullable)       -- null if pasted
  last_booking_date                -- MAX(TimeBooking.date) in this batch

Holiday
  date, name, country, state, is_workday
  UNIQUE(date, country, state)
```

### Derived (computed on read, never stored)

| Metric | Computation |
|---|---|
| available_days(person, period) | working_days − holidays − PersonAbsences − est. vacation |
| daily_target(person, project, day) | MilestonePersonBudget.current_hours ÷ available_days_in_month |
| actual_hours(person/project, period) | SUM(TimeBooking.net_hours) |
| cumulative_ist_soll | SUM(actual − target) up to reference date |
| milestone_drift | current_hours − initial_hours |
| budget_remaining_h | total_budget_hours − SUM(closed milestone current_hours) |
| budget_remaining_€ | SUM(BillingPosition.budget_euros) − SUM(InvoicePersonEntry.amount_euros) |
| utilisation_rate | weekly_capacity_hours ÷ Person.default_weekly_hours |
| planned_hours(person, project) | SUM(MilestonePersonBudget.initial_hours) for person+project |

---

## Sage Import — Project Matching

Each `TimeBooking` must be assigned to a `Project`. Since Sage exports contain `sage_project_name`, the mapping is:

1. On first import: if `sage_project_name` has never been seen before, user is prompted to map it to an existing Project (or create one). The mapping is stored as `SageProjectMapping(sage_project_name → project_id)`.
2. On subsequent imports: known mappings are applied automatically; new unknown names prompt again.
3. This handles the case where one Sage export contains entries for multiple projects.

```
SageProjectMapping
  id, sage_project_name, project_id
```

---

## Pages / UI

### Calendar Page (central)
- Month/week view across all persons
- **Toggleable layers:** holidays (background), vacation (yellow), training (blue), sick/ongoing (red, striped for estimated), sick/confirmed (red solid), project assignments (colour per project), milestone boundaries
- **Filters:** person(s), project(s), layer types
- **Interactions:** click day → add/edit absence; sick leave shows "estimated" badge until confirmed

### Project Overview Dashboard
- All programs/projects, status, budget burn (hours + €), milestone compliance summary

### Project Detail Page
- Membership list with capacity and rates
- Milestone timeline: initial vs current hours, drift indicators, open/closed/locked status
- Monthly table: available days, target hours (from MilestonePersonBudget), actual hours, Ist-Soll
- Rebalancing suggestion panel (shown when drift detected; accept/edit/dismiss)
- Zahlungsplan view (MonthlyInvoice status per month)

### Person Page
- VacationContingent per year vs booked + estimated days
- Absence calendar
- Active project assignments

### Import Page
- Upload file or paste tab-separated Sage export
- SageProjectMapping confirmation step (new names flagged)
- Person-match confirmation (fuzzy match review)
- Preview before committing; shows ImportBatch summary after

---

## Features — Phased

### Phase 1 — Core (MVP)
- [ ] Project & Program CRUD; BillingPosition management
- [ ] Person management + VacationContingent
- [ ] ProjectMembership (capacity, rates, date ranges)
- [ ] PersonAbsence — date ranges, all types/statuses, enum validation
- [ ] Holiday API (fetch + cache; failure warning)
- [ ] Milestone initialisation (auto-populate from memberships; MilestonePersonBudget)
- [ ] SageProjectMapping + person-match confirmation
- [ ] Sage import (file + paste, ImportBatch tracking, deduplication)
- [ ] Calendar page (all layers, filterable)
- [ ] Project detail: monthly summary + drift indicators
- [ ] Project overview dashboard
- [ ] Alembic migrations wired up from day one

### Phase 2 — Rebalancing & Finance
- [ ] Rebalancing engine + suggestion UI (hours + € conflict flagging)
- [ ] Month-end close flow (lock → MonthlyInvoice; last-import warning)
- [ ] Unlock with audit note + confirmation dialog
- [ ] Zahlungsplan view (invoice status, € burn)
- [ ] Vacation contingent estimation integrated into availability
- [ ] Tests for planning/availability service (pytest)

### Phase 3 — Multi-user (future)
- [ ] Auth (JWT or OAuth)
- [ ] PostgreSQL migration (Alembic handles it)
- [ ] Role-based access
- [ ] Deploy as internal web service

---

## Session Log

### 2026-04-21
- Analyzed Excel files via Python/openpyxl and M365 MCP
- Confirmed project/program hierarchy and billing model
- Confirmed: billing rate fixed per sub-project; PersonAbsence global per person
- Decided: Bavaria holidays from API, not hardcoded; strict DSGVO code/data separation
- Critical review of Excel: dropped redundant per-day plan columns — all plan values computed from Milestones + availability; only actual_hours stored (via TimeBooking)

### 2026-04-22
- Clarified milestone structure: always per calendar month, project-level for billing
- Added MilestonePersonBudget: per-person hour split within each milestone
- Clarified financial non-linearity: different billing rates → hours ≠ €; both tracked
- Clarified sick leave: date-range absence, status ongoing→confirmed, each change triggers rebalancing
- Added month-end close flow: close → lock → create MonthlyInvoice; unlock requires confirmation
- PersonAbsence changed to date-range records (not per-day rows)
- Rebalancing: automatic suggestion; hours-first priority; € conflict flagged, not auto-resolved
- Added Alembic to tech stack (migrations, SQLite→Postgres path)
- Added ImportBatch entity (last-import-date tracking for month-close completeness check)
- Added SageProjectMapping entity (sage_project_name → project_id; handles multi-project exports)
- Added TimeBooking deduplication key (UNIQUE constraint on date+person+project+level+hours)
- Removed ProjectMembership.planned_hours (redundant; derived from MilestonePersonBudget sums)
- Removed Project.total_budget_euros (redundant; derived from SUM(BillingPosition.budget_euros))
- Fixed PersonAbsence.status enum: vacation/training use planned|confirmed; sick uses ongoing|confirmed; cross-type invalid states prevented by constraint
- Added holiday API failure handling: warns + blocks rather than silently computing wrong
- Added year-boundary handling for vacation contingent estimation
