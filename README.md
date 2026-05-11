# ProjektPlanner

A local-first web app for project time planning and billing tracking.
Import Sage ERP time bookings, plan monthly milestones per person, and track budget burn in hours and euros.

---

## Screenshots

| Calendar — monthly resource grid | Project — milestone table & budget |
|---|---|
| ![Calendar view](docs/screenshots/calendar.png) | ![Project detail](docs/screenshots/project-detail.png) |

| Sage ERP import with mapping resolver | Person detail — absences & vacation |
|---|---|
| ![Sage import](docs/screenshots/import.png) | ![Person detail](docs/screenshots/person-detail.png) |

---

## Features

- **Calendar view** — monthly resource grid per person with toggleable layers: public holidays, absences, project assignments, and milestone status
- **Milestone planning** — initialize per-person hour budgets from capacity, holidays, and absence estimates; track drift month by month as reality changes
- **Budget tracking** — progress bars for hours and euros consumed vs. planned; rebalancing suggestions for remaining months
- **Sage ERP import** — paste or upload CSV exports; auto-detects separator; guided project-mapping resolver for unmapped bookings
- **Invoice records** — close months to lock milestones and generate a Zahlungsplan; reopen with confirmation
- **Person management** — vacation contingents, sick leave, training absences; default billing rate and weekly capacity per person
- **Programs** — group projects under a Hauptprojekt; filter calendar and reports by program

---

## Quick start

> **Prerequisites:** Python 3.12+, Node.js 20+, and [uv](https://docs.astral.sh/uv/)
> ```bash
> pip install uv          # or: winget install astral-sh.uv
> ```

### 1 — Start the backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

API running at `http://localhost:8000` · Interactive docs at `http://localhost:8000/docs`

### 2 — Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` — the frontend proxies `/api/*` to the backend automatically.

### 3 — Seed demo data (optional)

```bash
cd backend
uv run python scripts/seed.py
```

Creates two fictional projects (Acme Corp), two persons, memberships, billing positions, and initialized milestones — no real names or figures.

---

## Running tests

```bash
# Backend unit tests
cd backend && uv run pytest

# Frontend unit tests
cd frontend && npm test

# E2E tests (requires both servers running)
cd frontend && npm run test:e2e
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + SQLModel + SQLite (WAL mode) |
| Package manager | uv (Python 3.12+) |
| Frontend | React 19 + Vite + TypeScript |
| Styling | Tailwind CSS v4 |
| State / data | TanStack Query v5 |
| Tests | pytest · Vitest · Playwright |
| Holiday data | feiertage-api.de (cached in DB) |

---

## Project structure

```
backend/
  app/
    main.py           FastAPI app + router registration
    routers/          One file per domain (projects, persons, calendar, …)
    models/           SQLModel entities
    services/         Business logic (holidays, planning math, import)
  scripts/seed.py     Demo data seeder (fictional data only)
  tests/              pytest suite
  alembic/            DB migrations

frontend/
  src/
    api.ts            Typed API client (all endpoints)
    pages/            One file per route
    components/       Shared UI components
  e2e/                Playwright end-to-end tests

docs/
  plan-architecture.md  System architecture and data flow
  implementation/       Step-by-step implementation notes
```

---

## Privacy

All person names, project numbers, billing rates, and time bookings are stored in the local SQLite database only — never sent to any server.
The database file (`backend/data/`) is excluded from version control.
Demo and development runs use fictional data exclusively.
