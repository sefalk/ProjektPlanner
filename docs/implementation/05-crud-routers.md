# Step 05 — CRUD Routers

_Branch: `feature/crud-routers`_

## Endpoints

| Prefix | Resource | Methods |
|---|---|---|
| `/programs` | Program | GET list, POST, GET one, PUT, DELETE |
| `/projects` | Project | GET list, POST, GET one, PUT, DELETE |
| `/projects/{id}/billing-positions` | BillingPosition | GET list, POST, DELETE |
| `/projects/{id}/memberships` | ProjectMembership | GET list, POST, DELETE |
| `/persons` | Person | GET list, POST, GET one, PUT, DELETE |
| `/persons/{id}/absences` | PersonAbsence | GET list, POST, PUT, DELETE |
| `/persons/{id}/vacation-contingents` | VacationContingent | GET list, POST, PUT |

## Conventions
- 201 Created on POST, 204 No Content on DELETE
- 404 when resource not found
- 409 Conflict on unique-constraint violations (IntegrityError → friendly message)
- List endpoints support `skip` / `limit` query params (default limit=100)
- SQLModel table models used directly as request bodies — `id` field is ignored on create
