# Implementation Overview

_Last updated: 2026-04-22_

Each step has its own detail document and its own Git feature branch.
Branches merge to `dev` only when all tests pass and the user approves.
`main` is only updated on explicit user sign-off.

## GitFlow

```
main        production-ready snapshots (manual merge only)
  └── dev   integration branch (all features land here first)
        └── feature/xxx   one branch per implementation step
```

## Backend Implementation Steps

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
| 09 | `feature/invoice-service` | Month-close, lock/unlock, invoice creation | 🔄 in progress |

## Status legend
- 🔲 planned
- 🔄 in progress
- ✅ merged to dev
- 🚀 merged to main
