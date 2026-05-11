# ProjektPlanner

A local-first web app for project time planning and billing tracking — import Sage ERP time bookings, plan monthly milestones per person, and track budget burn in hours and euros.

## What it does

- Manage **projects, programs, and team members** with individual billing rates and weekly capacities
- Plan monthly milestones at project start; track drift as reality (sick leave, vacation) changes
- **Import time bookings from Sage ERP** — file upload or paste, with guided project-mapping resolver
- Track vacation contingents per person; public holidays fetched automatically via API (Bavaria/Germany)
- Close months to lock milestones and generate invoice records (Zahlungsplan)
- **Calendar view** — month resource grid with toggleable layers: holidays, absences, project assignments
- **Project dashboard** — budget burn bar and open/overdue milestone indicators per project
- **Person detail** — absences (vacation, sick, training) and vacation contingent management

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLModel + SQLite (WAL mode) |
| Package manager | uv (Python 3.12+) |
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v4 |
| State / data | TanStack Query v5 |
| Tests (backend) | pytest |
| Tests (frontend) | Vitest (unit) + Playwright (E2E) |
| Holiday data | feiertage-api.de (cached in DB) |

## Quick start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (`pip install uv` or `winget install astral-sh.uv`)
- Node.js 20+

### 1 — Backend

```bash
cd backend

# Install dependencies
uv sync

# Start the API server
uv run uvicorn app.main:app --reload --port 8000
```

The API is now available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

**Optional — seed demo data** (requires the server to be running):

```bash
uv run python scripts/seed.py
```

This creates pseudo-data projects, persons, memberships, and milestones — no real names or billing figures.

### 2 — Frontend

```bash
cd frontend

npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

> The frontend proxies `/api/*` to `http://localhost:8000` automatically via the Vite dev server.

### 3 — Run tests

```bash
# Backend unit tests
cd backend && uv run pytest

# Frontend unit tests
cd frontend && npm test

# E2E tests (requires both servers running)
cd frontend && npm run test:e2e
```

## Project structure

```
backend/
  app/
    main.py           FastAPI app + router registration
    db.py             SQLite engine (WAL mode, 30 s busy timeout)
    routers/          One file per domain (projects, persons, calendar, …)
    models/           SQLModel entities
    services/         Business logic (holidays, planning math, import)
  seed/               Dev data definitions (pseudo data only)
  scripts/
    seed.py           Seed runner — POSTs to the live API
  tests/              pytest test suite
  alembic/            DB migrations

frontend/
  src/
    api.ts            Typed API client (all endpoints)
    pages/            One file per route
    components/       Shared components (Table, Modal, PageHeader)
  e2e/                Playwright end-to-end tests (39 tests)
  src/test/           Vitest unit tests

docs/
  plan.md             Development plan and session log
  plan-architecture.md  System architecture and data flow diagrams
  implementation/     Step-by-step implementation notes (01–09)
```

## Privacy / DSGVO

All person names, project numbers, billing rates, and hour bookings live in the local database only.  
The database file (`backend/data/`) is excluded from version control.  
Development and demo runs use pseudo data exclusively — see `backend/seed/dev_data.py`.

## Docs

- [Development Plan](docs/plan.md)
- [Architecture](docs/plan-architecture.md)
- [Implementation overview](docs/implementation/00-overview.md)
