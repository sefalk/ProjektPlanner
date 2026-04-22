# Step 04 — Planning Service

_Branch: `feature/planning-service`_

## Goal

Implement `app/services/planning.py`: the core availability and capacity math that
underpins milestone initialisation, rebalancing suggestions, and invoice creation.

---

## Functions to implement

### 1. `working_days(start, end) → int`

Count Mon–Fri days in `[start, end]` (both inclusive), ignoring holidays.

### 2. `available_days(person_id, start, end, country, state, session, client) → float`

```
available_days =
    working_days(start, end)
    − workday_holidays(start, end, country, state)   ← is_workday=True only
    − absence_days(person_id, start, end)            ← confirmed + ongoing sick + vacation + training
    − estimated_vacation(person_id, start, end)      ← unplanned remainder
```

Returns a float (can be negative if absences exceed working days — the UI warns
but does not block).

### 3. `capacity_hours(person_id, project_id, start, end, session, client) → float`

```
capacity_hours =
    available_days(person_id, start, end, project.holiday_country, project.holiday_state, ...)
    × (membership.weekly_capacity_hours / 5)
```

Uses `ProjectMembership` for the person+project to get `weekly_capacity_hours`.
If no active membership exists in the period, returns 0.0.

### 4. `absence_days_in_range(person_id, start, end, session) → float`

Sum of overlapping calendar days from all `PersonAbsence` records
(excluding `status=planned` for sick — but sick has no planned status, so:
vacation/training both planned+confirmed count; sick only ongoing+confirmed).

Per plan: *"Each change triggers rebalancing"*, and availability uses:
> vacation / training → planned | confirmed
> sick                → ongoing | confirmed

### 5. `estimated_vacation_days(person_id, start, end, session) → float`

```
per year segment in [start, end]:
    contingent = VacationContingent.total_days for that year (0 if missing)
    used = Σ PersonAbsence[vacation, confirmed|planned, in year] in calendar days
    remaining_contingent = max(0, contingent − used)
    fraction = period_days_in_year / remaining_days_in_year_from_start
    estimate = remaining_contingent × fraction
```

Only applies to days NOT already covered by a concrete absence record.

---

## Key design decisions

- All functions are **pure / side-effect-free** (except the holiday lookup which
  hits the DB/API). No session writes.
- `working_days` uses `datetime.date.weekday()` — no third-party calendar lib.
- Absence overlap: a `PersonAbsence(start_date, end_date)` overlaps `[start, end]`
  when `absence.start_date <= end AND absence.end_date >= start` (null end_date
  treated as "today + buffer" for ongoing sick).
- For `end_date=None` (sick ongoing), use `date.today()` as the effective end for
  date-range math (the service layer does not look into the future for sick leave).

---

## Files

| File | Purpose |
|---|---|
| `backend/app/services/planning.py` | Service implementation |
| `backend/tests/unit/test_services_planning.py` | Unit tests + hypothesis |

---

## Test list

| # | Test | Type |
|---|---|---|
| 1 | `test_working_days_mon_to_fri` | basic: Mon–Fri = 5 |
| 2 | `test_working_days_includes_both_endpoints` | edge: same-day = 1 if weekday |
| 3 | `test_working_days_weekend_only_is_zero` | edge: Sat–Sun = 0 |
| 4 | `test_working_days_full_week` | Mon–Sun = 5 |
| 5 | `test_working_days_end_before_start_returns_zero` | guard |
| 6 | `@given` working_days ≥ 0 always | property |
| 7 | `@given` working_days ≤ calendar_days always | property |
| 8 | `test_absence_days_no_absences` | zero result |
| 9 | `test_absence_days_full_overlap` | absence covers entire period |
| 10 | `test_absence_days_partial_overlap` | absence starts before period |
| 11 | `test_absence_days_ongoing_sick_uses_today` | null end_date |
| 12 | `test_absence_days_multiple_absences` | sum |
| 13 | `test_estimated_vacation_no_contingent` | 0 when no VacationContingent row |
| 14 | `test_estimated_vacation_all_used` | 0 when contingent fully planned |
| 15 | `test_estimated_vacation_proportional` | fraction logic |
| 16 | `test_available_days_no_absences_no_holidays` | working days only |
| 17 | `test_available_days_subtracts_holidays` | holiday deduction |
| 18 | `test_available_days_subtracts_absences` | absence deduction |
| 19 | `test_available_days_can_be_negative` | negative allowed |
| 20 | `test_capacity_hours_no_membership_returns_zero` | guard |
| 21 | `test_capacity_hours_with_membership` | hours = days × rate |
| 22 | `@given` capacity_hours ≥ 0 for valid inputs | property |

---

## Acceptance criteria

- All tests pass, `app/services/planning.py` coverage ≥ 90 %.
- `working_days` is O(1) using integer arithmetic, not a loop.
- `available_days` never raises; returns float (possibly negative).
- No network calls from `working_days`, `absence_days_in_range`, or
  `estimated_vacation_days`.
