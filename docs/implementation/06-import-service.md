# Step 06 — Import Service

_Branch: `feature/import-service`_

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/imports` | Upload a Sage ERP CSV; returns InsertResult (201) |
| GET | `/imports` | List ImportBatch records |
| GET | `/imports/{id}` | Get one ImportBatch |
| GET | `/sage-project-mappings` | List all project name mappings |
| POST | `/sage-project-mappings` | Create mapping (201) |
| GET | `/sage-project-mappings/{id}` | Get one mapping |
| PUT | `/sage-project-mappings/{id}` | Update mapping |
| DELETE | `/sage-project-mappings/{id}` | Delete mapping (204) |

## CSV Format

The endpoint accepts a multipart file upload (`field name: file`).

Supported delimiters: `;` (semicolon) and `,` (comma) — auto-detected.

Supported date formats: `DD.MM.YYYY` (German locale) and `YYYY-MM-DD` (ISO).

Decimal separator: both `.` and `,` accepted for `net_hours`.

UTF-8 with BOM is handled correctly.

### Column names (German or English)

| Canonical name | German alias | English alias |
|---|---|---|
| `booking_date` | `Buchungsdatum`, `Datum` | `date`, `booking date` |
| `sage_employee_name` | `Mitarbeiter` | `employee`, `person` |
| `sage_project_name` | `Sage-Projekt`, `Projekt` | `project` |
| `sage_project_level` | `Projektebene`, `Ebene` | `level` |
| `net_hours` | `Nettozeit`, `Stunden` | `hours`, `net hours` |
| `duration_raw` | `Dauer` | `duration` (optional) |
| `break_duration` | `Pause` | `break` (optional) |

## Import workflow

1. **Resolve Sage project names**: every unique `sage_project_name` in the file must have a `SageProjectMapping` row pointing to an internal `Project`. If any are missing, the endpoint returns **422** with `{"detail": "Unresolved Sage project names", "unresolved_projects": [...]}`.
2. **Fuzzy-match persons**: employee name strings are matched to `Person.sage_employee_name` using fuzzy string matching (threshold 80/100). Unmatched names return **422** with `{"detail": "Could not match persons", "unmatched_persons": [...]}`.
3. **Create ImportBatch records**: one batch per distinct project found in the file.
4. **Create TimeBooking records**: duplicate rows (same date + person + project + level + hours) are silently skipped via the UNIQUE constraint. The response includes `inserted` and `skipped` counts.

## Conventions

- 201 Created on POST /imports with `ImportResultOut` body
- 409 on duplicate `sage_project_name` in POST /sage-project-mappings
- 404 when mapping or batch not found
- Time bookings are never deleted; re-importing the same file is safe (idempotent)
