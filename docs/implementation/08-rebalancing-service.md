# Step 08 — Rebalancing Service

_Branch: `feature/rebalancing-service`_

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/projects/{id}/rebalancing/drift` | Per-person drift: actual − planned hours |
| GET | `/projects/{id}/rebalancing/suggestions` | Suggested budget adjustments for open milestones |
| POST | `/projects/{id}/rebalancing/apply` | Apply suggestions to all open milestones |

## Concepts

**Drift** (`PersonDrift`) — accumulated difference between booked hours (TimeBooking rows) and originally planned hours (MilestonePersonBudget.initial_hours) for a person across all milestones of a project.
- `drift_hours > 0`: person has booked more than planned
- `drift_hours < 0`: person has booked less than planned

**Suggestion** (`MilestoneSuggestion`) — for each open (unlocked) milestone, a capacity-proportional split of `Milestone.current_hours` across active members.
- Proportional to `raw_capacity = working_weekdays_in_month × (weekly_capacity_hours / 5)`
- `SUM(suggested_hours) == Milestone.current_hours` (total is preserved)

## Apply workflow

`POST /projects/{id}/rebalancing/apply`:
1. Computes suggestions
2. Updates `MilestonePersonBudget.current_hours` for each open milestone
3. Re-syncs `Milestone.current_hours = SUM(updated budgets)`
4. Locked milestones are silently skipped
5. Idempotent: applying twice gives the same result

## Conventions

- 404 when project not found
- Apply returns 200 with a list of updated budget records `{id, person_id, current_hours}`
- Locked milestones are never modified
