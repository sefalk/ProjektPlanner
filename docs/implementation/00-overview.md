# Implementation Overview

_Last updated: 2026-04-24_

Each backend step has its own detail document and its own Git feature branch.
Branches merge to `dev` only when all tests pass.
`main` is only updated on explicit user sign-off.

## GitFlow

```
main        production-ready snapshots (manual merge only)
  └── dev   integration branch (all features land here first)
        └── feature/xxx   one branch per implementation step
```

## Phase 1 — Core MVP (Steps 01–12)

| # | Branch | Description | Status |
|---|---|---|---|
| 01 | `feature/backend-scaffold` | Docker env, project structure, FastAPI skeleton, test infra | ✅ merged to dev |
| 02 | `feature/core-models` | All SQLModel entities + Alembic initial migration | ✅ merged to dev |
| 03 | `feature/holiday-service` | Holiday API fetch + cache service + tests | ✅ merged to dev |
| 04 | `feature/planning-service` | Availability calc, vacation estimation (core math) | ✅ merged to dev |
| 05 | `feature/crud-routers` | REST endpoints: programs, projects, persons, memberships, absences, contingents | ✅ merged to dev |
| 06 | `feature/import-service` | Sage file parsing, project mapping, deduplication | ✅ merged to dev |
| 07 | `feature/milestone-service` | Milestone init from project setup + invariant enforcement | ✅ merged to dev |
| 08 | `feature/rebalancing-service` | Drift detection + suggestion engine | ✅ merged to dev |
| 09 | `feature/invoice-service` | Month-close, lock/unlock, invoice creation | ✅ merged to dev |
| 10 | `feature/frontend` | React + Vite scaffold; Projects, Persons, Programs, Sage-Mapping CRUD pages; sidebar nav; Modal + Table components; accessibility baseline; Vitest unit tests | ✅ merged to dev |
| 11 | `dev` (direct) | Calendar resource grid (month view, layer chips, legend, milestone badges); Sage Import page with mapping resolver and import history; PersonDetailPage with absences + vacation contingents; PersonsPage row-click navigation | ✅ on dev |
| 12 | `dev` (direct) | Project overview dashboard: budget burn bar + open/overdue milestone counts via `GET /projects/stats`; person and vacation-contingent edit modals; E2E suite expanded to 39 tests (calendar, import, person-detail specs); accessibility fixes (contrast, scrollable region) | ✅ on dev |

## Phase 2 — Review v0.1.0 (Steps 13–17)

Derived from the visual review on 2026-04-23. See individual plan documents for detail.

| # | Doc | Description | Status |
|---|---|---|---|
| 13 | [13-v02-quick-ux-wins.md](13-v02-quick-ux-wins.md) | App title, edit/delete buttons in all tables, delete confirmations, Start column in Projekte, Geplant status, projects column in Personen, Hauptprojekte rename + linked-projects sub-row, Sage-Mapping edit, Hauptprojekt shown in project detail, reopen confirmation | ✅ on dev |
| 14 | [14-v03-sage-import-rework.md](14-v03-sage-import-rework.md) | New Sage CSV format (`h:mm` duration, new column names), multi-separator support, structured error responses | ✅ on dev |
| 15 | [15-v04-data-model-extensions.md](15-v04-data-model-extensions.md) | Budget € on Project, daily work week patterns on Person, default billing rate on Person, Settings page + default vacation days | ✅ on dev |
| 16 | [16-v05-milestone-enhancements.md](16-v05-milestone-enhancements.md) | Per-person expandable milestone rows, improved init (holidays + absences + vacation distribution), rename "Aktuell", auto-rebalanced column, inline editing, sum row, budget € consumed | ✅ on dev |
| 17 | [17-v06-calendar-enhancements.md](17-v06-calendar-enhancements.md) | Dynamic width, per-project utilization bars, project/Hauptprojekt filters, milestone tooltip, forecast chart (Volles Budget / PLAN / Aktuell / Prognose) | ✅ on dev |

## Phase 3 — Calendar Utilization (Step 18)

| # | Doc | Description | Status |
|---|---|---|---|
| 18 | [18-v07-calendar-utilization.md](18-v07-calendar-utilization.md) | Today indicator, utilization badge, overbooking cells, %/h toggle, project label in bars, overbooking validation | ✅ on dev |

## Design docs (nicht chronologisch — Feature-Detailpläne)

| # | Doc | Description | Status |
|---|---|---|---|
| 25 | [25-multi-user-tenancy.md](25-multi-user-tenancy.md) | Multi-User: logische Mandantentrennung (eine DB + `owner_id` + zentraler Filter), In-App-Auth (fastapi-users, Session, Invite-Token), Encryption at Rest, Übergang zu geteiltem Arbeitsbereich | 📋 Design |

## Current state (dev branch)

Phase 1 complete. Phase 2 complete (Steps 13–17). Phase 3 complete (Step 18), app version v0.3.0. E2E suite: 56 tests across 9 files.

- **Backend**: 10 service layers, 35+ REST endpoints, SQLite (WAL mode)
- **Frontend**: 8 pages, typed API client, Playwright E2E, Vitest unit tests
- **Projekte**: edit + delete, Start column, Geplant status, budget €, burn bar, milestone badges
- **Personen**: edit + delete, projects column, work week patterns, default billing rate
- **Hauptprojekte**: edit + delete + confirmation, expandable linked-projects sub-row
- **Sage-Mapping**: edit per row
- **Projekt-Detail**: Hauptprojekt in header, reopen confirmation, expandable milestone rows with per-person hours
- **Meilensteine**: improved init (holidays + absences + vacation distribution), rebalanced column, inline editing, sum row, € consumed
- **Kalender**: utilization bars, program/project filters, milestone tooltip, forecast chart (PLAN / Aktuell / Prognose), today indicator, utilization badge (green/amber/red), overbooking cells (red tint + top bar), %/h toggle, project label in bars
- **Einstellungen**: configurable default vacation days
- **Stabilität**: CORS-Fix (dev-Proxy korrekt), CASCADE-Delete für Personen, Accessibility-Kontrast WCAG AA, Modal-Fokus-Trap
- **Überbuchungs-Warnung**: Backend berechnet Überbuchungsmonate bei Mitgliedschafts-Erstellung; Frontend zeigt gelbes Banner

## Status legend

- 🔲 planned
- 🔄 in progress
- ✅ on dev
- 🚀 merged to main
