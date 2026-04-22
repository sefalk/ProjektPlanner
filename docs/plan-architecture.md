# ProjektPlanner — Architecture

_Last updated: 2026-04-22_

---

## System Overview

```mermaid
graph TB
    subgraph Browser["Browser (React SPA)"]
        UI["Pages & Components\n(React + TypeScript)"]
        APIClient["Typed API Client\n(fetch wrappers)"]
        UI <--> APIClient
    end

    subgraph Backend["Backend (FastAPI, Python)"]
        Router["Routers\n(HTTP endpoints)"]
        Services["Services\n(business logic)"]
        Models["Models\n(SQLModel)"]
        Router --> Services
        Services --> Models
    end

    subgraph Storage["Storage"]
        DB["SQLite\n(local dev)"]
        DBProd["PostgreSQL\n(future, multi-user)"]
    end

    subgraph External["External"]
        HolidayAPI["feiertage-api.de\n(holiday data)"]
        Sage["Sage ERP\n(manual export)"]
    end

    APIClient -- "HTTP / JSON\n(localhost)" --> Router
    Models <--> DB
    Models -.-> DBProd
    Services -- "HTTP GET\n(cached)" --> HolidayAPI
    Sage -- "CSV / paste" --> Browser
```

---

## Backend Layers

```mermaid
graph LR
    subgraph Routers
        R1["projects.py"]
        R2["persons.py"]
        R3["milestones.py"]
        R4["import_.py"]
        R5["invoices.py"]
        R6["calendar.py"]
        R7["holidays.py"]
    end

    subgraph Services
        S1["planning.py\n— availability calc\n— milestone init\n— daily targets"]
        S2["rebalancing.py\n— drift detection\n— suggestion engine\n— conflict flagging"]
        S3["import_.py\n— file parsing\n— person matching\n— project mapping\n— deduplication"]
        S4["invoice.py\n— month-close\n— invoice creation\n— lock/unlock"]
        S5["holiday.py\n— API fetch\n— cache management\n— failure handling"]
    end

    subgraph Models
        M["SQLModel entities\n(all DB tables)"]
        Alembic["Alembic\n(migrations)"]
    end

    Routers --> Services
    Services --> Models
    Alembic -.-> M
```

---

## Data Flow: Sage Import

```mermaid
sequenceDiagram
    actor User
    participant UI as Import Page
    participant Router as import_ router
    participant ImportSvc as import service
    participant DB

    User->>UI: Upload file / paste data
    UI->>Router: POST /import/preview
    Router->>ImportSvc: parse rows
    ImportSvc-->>Router: parsed rows + unknown project names + unmatched persons
    Router-->>UI: preview + mapping gaps

    User->>UI: Confirm project mappings + person matches
    UI->>Router: POST /import/commit
    Router->>ImportSvc: apply mappings, upsert TimeBookings
    ImportSvc->>DB: INSERT OR IGNORE (dedup key)\nINSERT ImportBatch
    DB-->>ImportSvc: ok
    ImportSvc->>DB: trigger rebalancing check
    ImportSvc-->>Router: ImportBatch summary
    Router-->>UI: result (n inserted, n skipped as duplicates)
    UI-->>User: summary + rebalancing suggestions if drift detected
```

---

## Data Flow: Milestone Rebalancing

```mermaid
sequenceDiagram
    participant Trigger as Trigger\n(import / absence change / month-close)
    participant RebalSvc as rebalancing service
    participant PlanningSvc as planning service
    participant DB
    participant UI

    Trigger->>RebalSvc: rebalance(project_id)
    RebalSvc->>DB: fetch open milestones + MilestonePersonBudgets
    RebalSvc->>DB: fetch closed milestone totals + open TimeBookings
    RebalSvc->>PlanningSvc: available_days(person, month) for each open month
    PlanningSvc->>DB: holidays + PersonAbsences + VacationContingent
    PlanningSvc-->>RebalSvc: capacity per person per month

    RebalSvc->>RebalSvc: compute remaining_hours\ndistribute proportionally to capacity\ncheck vs budget_euros

    alt hours/€ conflict
        RebalSvc-->>UI: suggestion + conflict warning
    else no conflict
        RebalSvc-->>UI: suggestion (diff vs current)
    end

    UI-->>User: show suggestion panel
    User->>UI: accept / edit / dismiss
    UI->>DB: PATCH milestones.current_hours (if accepted)
```

---

## Data Flow: Month-End Close

```mermaid
sequenceDiagram
    actor User
    participant UI as Project Detail Page
    participant Router as milestones router
    participant InvoiceSvc as invoice service
    participant DB

    User->>UI: Click "Close Month" for milestone M
    UI->>Router: GET /milestones/{id}/close-check
    Router->>DB: fetch last ImportBatch.last_booking_date for project
    DB-->>Router: last import date
    Router-->>UI: warning if last_booking_date < end_of_month(M)

    User->>UI: Confirm close (with or without warning)
    UI->>Router: POST /milestones/{id}/close
    Router->>InvoiceSvc: close_milestone(milestone_id)
    InvoiceSvc->>DB: SET milestone.status=closed, is_locked=true
    InvoiceSvc->>DB: SUM TimeBookings per person for month M
    InvoiceSvc->>DB: INSERT MonthlyInvoice + InvoicePersonEntries
    InvoiceSvc->>DB: trigger rebalancing for remaining open milestones
    InvoiceSvc-->>Router: invoice_id
    Router-->>UI: invoice created, milestone locked
    UI-->>User: padlock icon shown; Zahlungsplan updated
```

---

## Data Flow: Availability Calculation

```mermaid
flowchart TD
    A["availability_request\n(person, start, end, project)"] --> B

    B["working_days(start, end)\nMon–Fri only"]
    B --> C{"Holidays cached\nfor year/country/state?"}

    C -- No --> D["Call feiertage-api.de"]
    D -- Success --> E["Cache in Holiday table"]
    D -- Failure --> F["⚠ Return error:\navailability incomplete"]
    E --> G
    C -- Yes --> G

    G["Subtract holidays"]
    G --> H["Subtract PersonAbsences\n(vacation + training: planned/confirmed)\n(sick: confirmed)"]
    H --> I["Compute unplanned vacation estimate\nper year segment using VacationContingent"]
    I --> J["Subtract estimate\n(only for dates with no concrete absence)"]
    J --> K["available_days\n(result)"]

    K --> L["capacity_hours_per_day\n= weekly_capacity_hours / 5"]
    L --> M["total_capacity_hours\n= available_days × capacity_h/day"]
```

---

## Technology Interaction Summary

| What | Technology | Why |
|---|---|---|
| SPA framework | React + Vite + TypeScript | Component model, type safety, ecosystem |
| UI primitives | shadcn/ui + Tailwind | Unstyled-by-default, composable, no lock-in |
| API layer | FastAPI | Python, async, auto OpenAPI docs, Pydantic validation |
| Data models | SQLModel | SQLAlchemy + Pydantic unified; works with FastAPI natively |
| DB (local) | SQLite | Zero-config, single file, no server process |
| DB (scaled) | PostgreSQL | Connection-string swap; Alembic handles schema |
| Migrations | Alembic | Works with SQLModel; auto-generates scripts; supports SQLite + Postgres |
| Config | python-dotenv `.env` | DB URL, API endpoints, defaults; never in code |
| Holiday data | feiertage-api.de | Free, no auth; cached; fallback to OpenHolidays |
| Sage data | Manual file/paste | No API exists; import wizard with dedup + mapping |
| Python pkgs | uv | Fast resolver, lockfile, virtual env management |
| JS pkgs | pnpm | Fast, deterministic, disk-efficient |
| Backend tests | pytest | Unit tests mandatory for planning + rebalancing services |
| Frontend tests | Vitest | Unit tests for calculation utilities |

---

## Key Invariants (enforced by service layer)

1. `Σ MilestonePersonBudget.current_hours == Milestone.current_hours` for every milestone
2. `PersonAbsence.status=ongoing` is only valid when `absence_type=sick`
3. `PersonAbsence.status=planned` is only valid when `absence_type ∈ {vacation, training}`
4. A closed/locked Milestone's `initial_hours` and `InvoicePersonEntry` records are immutable without explicit unlock
5. `TimeBooking` deduplication: `UNIQUE(date, person_id, project_id, sage_project_level, net_hours)` — re-importing the same export is safe
6. `Holiday` table must be populated before availability is computed for any period — failure returns a warning, not a silent wrong result
