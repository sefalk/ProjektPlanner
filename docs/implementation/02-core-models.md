# Step 02 — Core Models & Initial Migration

_Branch: `feature/core-models`_
_Status: 🔄 in progress_

---

## Goal

Define all SQLModel table entities and generate the initial Alembic migration.
No business logic here — only data structure, field validation, and schema.

---

## Model files

```
backend/app/models/
  __init__.py          re-exports all models (required for Alembic discovery)
  enums.py             all Enum types shared across models
  program.py           Program
  project.py           Project
  person.py            Person, VacationContingent, PersonAbsence
  membership.py        ProjectMembership
  billing.py           BillingPosition
  milestone.py         Milestone, MilestonePersonBudget
  invoice.py           MonthlyInvoice, InvoicePersonEntry
  timebooking.py       TimeBooking, ImportBatch, SageProjectMapping
  holiday.py           Holiday
```

---

## Enums

| Enum | Values |
|---|---|
| `ProjectStatus` | `active`, `completed`, `archived` |
| `AbsenceType` | `vacation`, `training`, `sick` |
| `AbsenceStatus` | `planned`, `confirmed`, `ongoing` |
| `MilestoneStatus` | `open`, `closed` |
| `InvoiceStatus` | `planned`, `invoiced`, `paid` |

---

## Key design decisions

- **snake_case `__tablename__`** on every model — avoids ambiguous all-lowercase defaults
- **Pydantic `@model_validator(mode="after")`** on `PersonAbsence` enforces the cross-field status/type constraint at the Python layer
- **`__table_args__`** for multi-column `UniqueConstraint` on:
  - `VacationContingent(person_id, year)`
  - `TimeBooking(date, person_id, project_id, sage_project_level, net_hours)`
  - `Milestone(project_id, year, month)`
  - `MilestonePersonBudget(milestone_id, person_id)`
  - `SageProjectMapping(sage_project_name)` — already unique via index
- **No `planned_hours` on `ProjectMembership`** — derived via `SUM(MilestonePersonBudget.initial_hours)`
- **No `total_budget_euros` on `Project`** — derived via `SUM(BillingPosition.budget_euros)`
- All monetary and hour values use `float` — sufficient precision for this domain

---

## PersonAbsence constraints (enforced by model_validator)

| absence_type | valid statuses | end_date required? |
|---|---|---|
| vacation | planned, confirmed | always |
| training | planned, confirmed | always |
| sick | ongoing, confirmed | only when confirmed |

Additional: `end_date >= start_date` when end_date is not null.

---

## Tests (written first — TDD)

### `tests/unit/test_models_enums.py`
- All enum values serialise to expected strings
- Invalid strings raise ValidationError

### `tests/unit/test_models_person.py`
- PersonAbsence rejects `ongoing` status for vacation/training
- PersonAbsence rejects `planned` status for sick
- PersonAbsence rejects `end_date < start_date`
- PersonAbsence accepts null end_date only when sick+ongoing
- Property-based: end_date always >= start_date when both set
- Property-based: PersonAbsence with valid type/status combinations never raises

### `tests/unit/test_models_milestone.py`
- Milestone month field rejects 0 and 13
- MilestonePersonBudget hours fields reject negatives
- Property-based: valid month always in [1, 12]

### `tests/unit/test_models_general.py`
- All models accept valid minimal data
- Required fields raise ValidationError when missing

---

## Alembic migration

After all models are defined:
```
alembic revision --autogenerate -m "initial schema"
```

The migration is reviewed and committed. It includes:
- All table `CREATE` statements
- UniqueConstraints and Indexes
- CHECK constraint on `PersonAbsence` (added manually after autogenerate)

---

## Acceptance criteria

- [ ] All models importable without error
- [ ] All tests pass with ≥ 90% coverage
- [ ] `alembic upgrade head` runs cleanly on a fresh SQLite DB
- [ ] `alembic downgrade base` rolls back cleanly
- [ ] No sensitive data in any model defaults or seed references
