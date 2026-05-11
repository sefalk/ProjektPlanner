# Step 07 — Milestone Service

_Branch: `feature/milestone-service`_

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/projects/{id}/milestones/initialize` | Create milestones for all months in range (201) |
| GET | `/projects/{id}/milestones` | List milestones, ordered by year/month |
| GET | `/projects/{id}/milestones/{mid}` | Get one milestone |
| GET | `/projects/{id}/milestones/{mid}/budgets` | List per-person budgets |
| PUT | `/projects/{id}/milestones/{mid}/budgets/{bid}` | Update a budget (syncs milestone total) |

## Data model

- **Milestone**: one calendar month of planned work for a project (`year`, `month`, `project_id`). Holds `initial_hours` (set at init, never changed) and `current_hours` (updated by budget changes and rebalancing).
- **MilestonePersonBudget**: per-person hour split within a milestone.

## Invariant

> `Milestone.current_hours == SUM(MilestonePersonBudget.current_hours)`

Enforced by `update_person_budget()`: every budget update recomputes the parent milestone's `current_hours` from the sum of all its budget rows.

## Initialization

`POST /projects/{id}/milestones/initialize` runs `initialize_milestones()`:
- Creates one `Milestone` per calendar month between `project.start_date` and `project.end_date`.
- Creates one `MilestonePersonBudget` per active `ProjectMembership` per month.
- `initial_hours = working_weekdays_in_effective_period × (weekly_capacity_hours / 5)`. No holiday or absence deductions — this is the "planned maximum" at setup time.
- Idempotent: existing milestones are not modified; only newly created ones are returned.

## Locked milestones

`Milestone.is_locked = True` prevents any budget updates (returns 409). Locking is set by the invoice service during month-close (Step 09).

## Conventions

- 201 on POST /initialize (returns newly created milestones; empty list if already initialized)
- 404 when project / milestone / budget not found
- 409 when milestone is locked
