# v0.8 — Data Storage: Configurable DB Path & Project Export/Import

**Status:** Planned  
**Date:** 2026-04-29  
**Decided by:** Project team

---

## Background

The ProjektPlanner stores all data in a single SQLite file at
`backend/data/projektplanner.db`. The path is already configurable via the
`DATABASE_URL` environment variable, but there is no UI to change it and no
mechanism to move the file at runtime. This was identified as a gap in the
v0.1 review (Allgemein §3) and deliberately deferred.

### Requirement withdrawn

An initial requirement to split data *per project* into separate files
(mirroring the old one-Excel-per-project workflow) was considered and
**withdrawn** after analysis. The main reasons:

- SQLite has no cross-database foreign keys — a calendar view spanning
  multiple projects would be impossible without in-process joins.
- Alembic migrations would need to be applied to every project file.
- The Persons problem (one person belongs to many projects) has no clean
  solution in a split-file model.

The chosen approach keeps a single central database and adds portability
through two independent mechanisms described below.

---

## Chosen Approach

### Mechanism 1 — Configurable database path (UI-settable)

The database file location is made configurable from the Settings page in
the UI. The user can enter any absolute path (e.g., an OneDrive folder or a
network share). When the path changes, the backend:

1. Copies the current database file to the new location.
2. Updates the stored path setting.
3. Reconnects the SQLAlchemy engine to the new URL.
4. Requires a backend restart to take effect (or reconnects in-process if
   feasible without engine re-creation).

This is the primary answer to "store all data externally": point the DB at an
OneDrive-synced folder and the entire dataset moves there automatically.

**⚠ Multi-user note (future):** SQLite is designed for single-writer access.
At the current scale (one user) this is fine. If multiple users need
concurrent write access, the database should be migrated to PostgreSQL —
`DATABASE_URL` already supports this without code changes. This must be
addressed before any multi-user deployment.

### Mechanism 2 — Per-project JSON export/import

Individual projects can be exported to a self-contained ZIP archive and later
imported on a different instance.

#### Export format

```
PRJ-001_export_2026-04-29.zip
├── manifest.json          ← schema version, export date, project_number
├── project.json           ← Project row
├── memberships.json       ← ProjectMembership rows
├── billing_positions.json ← BillingPosition rows
├── milestones.json        ← Milestone + MilestonePersonBudget rows
├── bookings.json          ← ImportBatch + TimeBooking rows
├── invoices.json          ← MonthlyInvoice + InvoicePersonEntry rows
├── sage_mappings.json     ← SageProjectMapping rows for this project
└── persons.json           ← Person rows for all members, incl. absences
                             and vacation contingents
```

Persons are **embedded in the export** (Strategy B). The export is fully
self-contained — it can be loaded without any pre-existing data on the target
instance.

The program (`program_id`) is included as a soft reference by
`program_number` + `name`; it is created on import if missing.

#### Import behaviour

On import the system performs a diff against the current state:

| Entity | Match key | Conflict behaviour |
|---|---|---|
| Project | `project_number` | Ask: overwrite / create copy / abort |
| Person | `sage_employee_name` | Show diff of differing fields; user selects per-field which value to keep |
| Program | `program_number` | Auto-merge (programs have no user-editable sub-data) |
| SageProjectMapping | `sage_project_name` | Auto-merge (re-map to imported project) |
| Milestones / Bookings | project-scoped, no overlap | Always imported fresh |

The import UI follows the same pattern as the Sage CSV resolver: an inline
diff panel per conflicting entity before the import is committed.

---

## Implementation Plan

### Step 1 — Configurable DB path (implement first)

**Backend**

| File | Change |
|---|---|
| `backend/app/models/setting.py` | No change — `Setting` model already exists |
| `backend/app/services/db_management.py` | New — `get_db_path()`, `set_db_path(new_path)`, `copy_db_to(new_path)` |
| `backend/app/routers/settings.py` | Add `PUT /settings/database_path` that calls `set_db_path`, returns restart-required flag |
| `backend/app/db.py` | Read path from `Setting` table at startup (fallback: env var → default) |
| `backend/app/config.py` | Add `data_dir: str` fallback setting |

**Frontend**

| File | Change |
|---|---|
| `frontend/src/pages/SettingsPage.tsx` | Add "Datenbankpfad" section: current path display, editable input, "Übernehmen" button, restart-required warning banner |
| `frontend/src/api.ts` | Already has `settings.update()` — extend with specific `settings.getDbPath()` / `settings.setDbPath()` if needed |

**Behaviour on path change:**

1. Backend copies `projektplanner.db` to the new directory.
2. Stores `database_path` in the `setting` table at the *old* location (so the
   next startup reads the new path).
3. Returns `{ "restart_required": true }` to the frontend.
4. Frontend shows a banner: "Datenbankpfad geändert — bitte Backend neu starten."

On next startup `db.py` reads `DATABASE_URL` env var or `database_path`
setting and connects to the new path.

**⚠ Edge cases to handle:**
- New path does not exist → create directory
- New path is on a network share / OneDrive → warn about SQLite locking risk
  (informational only, do not block)
- Copy fails (disk full, permissions) → rollback, return 500

---

### Step 2 — Project export (`GET /projects/{id}/export`)

**Backend**

| File | Change |
|---|---|
| `backend/app/services/project_export.py` | New — `export_project(project_id, session) -> bytes` (ZIP) |
| `backend/app/routers/projects.py` | Add `GET /{project_id}/export` returning ZIP as `application/zip` |

`export_project` queries all project-scoped tables, collects the relevant
`Person` rows (via memberships), serialises to JSON, and writes a ZIP.

The `manifest.json` contains:
```json
{
  "schema_version": 1,
  "exported_at": "2026-04-29T10:00:00Z",
  "app_version": "0.8.0",
  "project_number": "PRJ-001"
}
```

**Frontend**

| File | Change |
|---|---|
| `frontend/src/pages/ProjectDetailPage.tsx` | Add "Exportieren" button in project settings tab → triggers download |
| `frontend/src/api.ts` | Add `projects.export(id)` → `fetch` with `blob()` response |

---

### Step 3 — Project import (`POST /projects/import`)

This is the most complex step and should be implemented after Step 2 is
stable.

**Backend**

| File | Change |
|---|---|
| `backend/app/services/project_import.py` | New — parse ZIP, run diff, apply import |
| `backend/app/routers/projects.py` | Add `POST /projects/import` (multipart upload) |

The import endpoint is a two-phase operation:

- **Phase 1 — Dry run** (`POST /projects/import?dry_run=true`): Parses the
  ZIP and returns a `ImportDiff` object describing what would change. No DB
  writes.
- **Phase 2 — Commit** (`POST /projects/import?dry_run=false` with resolved
  conflicts): Applies the import with the user's conflict resolutions.

`ImportDiff` schema:
```json
{
  "project": { "action": "overwrite|create_copy|conflict", "existing": {...}, "imported": {...} },
  "persons": [
    {
      "sage_employee_name": "Mustermann, Max",
      "action": "create|update|conflict",
      "conflicts": [
        { "field": "default_weekly_hours", "existing": 40.0, "imported": 32.0 }
      ]
    }
  ],
  "programs": [...],
  "summary": { "bookings": 150, "milestones": 12, "invoices": 2 }
}
```

**Frontend**

| File | Change |
|---|---|
| `frontend/src/pages/ImportPage.tsx` | Add "Projekt importieren" section (separate tab or collapsible panel) |

The import UI flow:
1. User uploads ZIP → frontend calls dry-run endpoint.
2. Diff is displayed: green (new), yellow (conflict), grey (unchanged).
3. For each conflict the user selects which value to keep (per field).
4. User confirms → frontend calls commit endpoint with resolutions.

---

## Deferred / Out of Scope

- **Multi-user / concurrent access**: Requires PostgreSQL. Not planned until
  there is a concrete need. Mark deployment docs with a prominent warning.
- **Automatic sync**: The DB path can point to an OneDrive folder, but
  real-time sync between multiple users is not supported with SQLite. Any
  multi-user scenario requires a server deployment with PostgreSQL.
- **Incremental export**: Exporting only bookings since last export date.
  Useful for large projects but adds complexity; defer until requested.
- **Selective import**: Importing only bookings from an export (not the full
  project). Defer.

---

## Verification Checklist

### Step 1
- [ ] Settings page shows current DB path.
- [ ] Change path to a new directory → backend copies DB → banner appears.
- [ ] After backend restart, data is available from the new location.
- [ ] Invalid/unreachable path shows a clear error (not a 500 crash).

### Step 2
- [ ] Export button downloads a ZIP file named `{project_number}_export_{date}.zip`.
- [ ] ZIP contains all expected JSON files.
- [ ] Persons file contains only members of the exported project.
- [ ] Re-importing the ZIP on a fresh DB recreates the project correctly.

### Step 3
- [ ] Dry-run returns a correct diff without writing anything.
- [ ] A conflict on `Person.default_weekly_hours` is correctly detected and shown.
- [ ] Accepting the import with "keep existing" leaves the person unchanged.
- [ ] Accepting the import with "keep imported" updates the person.
- [ ] Importing a project with a `project_number` that already exists offers overwrite / copy options.
