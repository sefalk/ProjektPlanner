# ProjektPlanner

A local-first web app for project time planning and billing tracking, built to replace a manual Excel workflow.

## What it does

- Manage projects, programs, and team members with individual billing rates and capacities
- Plan monthly milestones at project start; track drift as reality (sick leave, vacation) changes
- Import time bookings from Sage ERP (file upload or paste)
- Track vacation contingents globally per person; fetch public holidays automatically via API
- Close months to lock milestones and generate invoice records (Zahlungsplan)
- Calendar view with toggleable layers: holidays, absences, project assignments, milestones

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLModel + Alembic |
| Database | SQLite (local) → PostgreSQL (multi-user) |
| Frontend | React + Vite + TypeScript |
| UI | shadcn/ui + Tailwind CSS |
| Holiday data | feiertage-api.de (cached) |

## Project structure

```
backend/      FastAPI app, services, models, Alembic migrations
frontend/     React + Vite SPA
docs/         Architecture and planning documents
```

## Getting started

> Setup instructions will be added once the initial scaffolding is in place.

## Privacy / DSGVO

All person names, project numbers, billing rates, and hour bookings live in the database only.
The database file is excluded from version control. Development uses pseudo data exclusively.
See `backend/seed/dev_data.py` for the development seed (fake data only).

## Docs

- [Development Plan](docs/plan.md)
- [Architecture](docs/plan-architecture.md)
