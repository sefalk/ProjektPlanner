"""Milestone service — initialization and invariant enforcement.

Milestones represent one calendar month of planned work for a project.
The core invariant: SUM(MilestonePersonBudget.current_hours) == Milestone.current_hours.

Initialization:
  - One Milestone per calendar month between project.start_date and project.end_date.
  - One MilestonePersonBudget per active ProjectMembership for that month.
  - initial_hours considers: working weekdays, public holidays, confirmed absences,
    and estimated vacation from remaining contingent when no specific vacation is entered.
  - Calling initialize_milestones() again is safe: existing milestones are left untouched.

Budget updates:
  - Updating a MilestonePersonBudget.current_hours automatically syncs Milestone.current_hours.
  - Locked milestones cannot be modified (raises MilestoneLocked).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta
from dataclasses import dataclass

from sqlmodel import Session, select

from app.models.enums import AbsenceType
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.models.setting import Setting
from app.services.holiday import get_holidays_in_range
from app.services.planning import absence_days_in_range


class MilestoneLocked(Exception):
    """Raised when an attempt is made to modify a locked milestone."""


class MilestoneNotFound(Exception):
    pass


class BudgetNotFound(Exception):
    pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _months_in_range(start: date, end: date) -> list[tuple[int, int]]:
    """Return (year, month) pairs for every month overlapping [start, end]."""
    months: list[tuple[int, int]] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return months


def _overlap_days(range_start: date, range_end: date, a_start: date, a_end: date) -> int:
    overlap_start = max(range_start, a_start)
    overlap_end = min(range_end, a_end)
    if overlap_end < overlap_start:
        return 0
    return (overlap_end - overlap_start).days + 1


def _parse_work_week_pattern(pattern: str) -> list[float] | None:
    parts = [p.strip() for p in pattern.split(",")]
    if len(parts) != 5:
        return None
    try:
        values = [float(p) for p in parts]
    except ValueError:
        return None
    return values if sum(values) > 0 else None


def _vacation_estimate_for_month(
    person_id: int,
    year: int,
    month: int,
    session: Session,
) -> float:
    """Estimate unplanned vacation days for person in a given month.

    Only called when no specific vacation absences exist for that month.
    Distributes the annual contingent evenly over 12 calendar months so that
    short projects don't over-estimate vacation and eliminate all capacity.
    """
    contingent = session.exec(
        select(VacationContingent).where(
            VacationContingent.person_id == person_id,
            VacationContingent.year == year,
        )
    ).first()
    if not contingent or contingent.total_days <= 0:
        return 0.0

    # Distribute over the full calendar year (12 months), not project months.
    # Using project months as denominator causes short projects to over-estimate vacation
    # (e.g. a 1-month project with 30-day contingent → 30 days in one month → 0 capacity).
    return contingent.total_days / 12


def _get_setting_float(session: Session, key: str, default: float) -> float:
    setting = session.get(Setting, key)
    if setting is None:
        return default
    try:
        return float(setting.value)
    except (ValueError, TypeError):
        return default


def _calendar_work_days(year: int, month: int, holiday_country: str, holiday_state: str, session: Session) -> int:
    """Count Mon-Fri working days in a calendar month, excluding public holidays."""
    month_start, month_end = _month_bounds(year, month)
    holidays = get_holidays_in_range(month_start, month_end, holiday_country, holiday_state, session)
    holiday_dates = {h.holiday_date for h in holidays if h.is_workday}
    count = 0
    d = month_start
    while d <= month_end:
        if d.weekday() < 5 and d not in holiday_dates:
            count += 1
        d += timedelta(days=1)
    return count


@dataclass
class PersonMonthStats:
    hours: float
    work_days: int
    absence_days: int
    holiday_days: int


def _person_available_hours(
    person: Person,
    membership: ProjectMembership,
    project: Project,
    year: int,
    month: int,
    session: Session,
) -> PersonMonthStats:
    """Compute available hours and day statistics for one person in one project month.

    Accounts for: work week pattern, public holidays, specific absences, and
    distributed vacation estimate when no specific vacation entries exist.
    """
    month_start, month_end = _month_bounds(year, month)
    eff_start = max(membership.from_date, month_start)
    eff_end = min(membership.to_date, month_end)
    if eff_end < eff_start:
        return PersonMonthStats(0.0, 0, 0, 0)

    # Public holidays in effective period
    holidays = get_holidays_in_range(eff_start, eff_end, project.holiday_country, project.holiday_state, session)
    holiday_dates = {h.holiday_date for h in holidays if h.is_workday}
    holiday_days_count = len(holiday_dates)

    # Working days in effective period (Mon-Fri, not holiday)
    working_day_list: list[date] = []
    d = eff_start
    while d <= eff_end:
        if d.weekday() < 5 and d not in holiday_dates:
            working_day_list.append(d)
        d += timedelta(days=1)
    work_days_count = len(working_day_list)

    if work_days_count == 0:
        return PersonMonthStats(0.0, 0, 0, holiday_days_count)

    # Gross hours from pattern or uniform
    pattern = _parse_work_week_pattern(person.work_week_pattern) if person.work_week_pattern else None
    if pattern:
        total_pattern = sum(pattern)
        gross_hours = sum(
            pattern[day.weekday()] * (membership.weekly_capacity_hours / total_pattern)
            for day in working_day_list
        )
    else:
        gross_hours = work_days_count * (membership.weekly_capacity_hours / 5.0)

    avg_daily_hours = gross_hours / work_days_count

    # Specific absence days (all types including vacation)
    abs_days = absence_days_in_range(person.id, eff_start, eff_end, session)

    # Distributed vacation estimate — only if no specific vacation overlaps this month
    has_vacation = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person.id,
            PersonAbsence.absence_type == AbsenceType.vacation,
            PersonAbsence.start_date <= eff_end,
            PersonAbsence.end_date >= eff_start,
        )
    ).first()
    vacation_estimate = 0.0
    if not has_vacation:
        vacation_estimate = _vacation_estimate_for_month(person.id, year, month, session)
        # Cap: can't estimate more vacation days than actual available working days
        vacation_estimate = min(vacation_estimate, max(0, work_days_count - abs_days))

    # Global sick / training day estimates — only if no specific absence of that type exists
    has_sick = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person.id,
            PersonAbsence.absence_type == AbsenceType.sick,
            PersonAbsence.start_date <= eff_end,
            PersonAbsence.end_date >= eff_start,
        )
    ).first()
    sick_estimate = 0.0 if has_sick else _get_setting_float(session, "sick_days_per_year", 10.0) / 12.0

    has_training = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id == person.id,
            PersonAbsence.absence_type == AbsenceType.training,
            PersonAbsence.start_date <= eff_end,
            PersonAbsence.end_date >= eff_start,
        )
    ).first()
    training_estimate = 0.0 if has_training else _get_setting_float(session, "training_days_per_year", 5.0) / 12.0

    total_deduction = abs_days + vacation_estimate + sick_estimate + training_estimate
    net_hours = gross_hours - total_deduction * avg_daily_hours
    return PersonMonthStats(
        hours=max(0.0, net_hours),
        work_days=work_days_count,
        absence_days=int(abs_days),
        holiday_days=holiday_days_count,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def initialize_milestones(project_id: int, session: Session, force: bool = False) -> list[Milestone]:
    """Create Milestone + MilestonePersonBudget rows for the full project range.

    When force=False (default): skips months that already have a Milestone (safe to call
    multiple times) and repairs member budget rows for existing milestones.

    When force=True: deletes all unlocked milestones and re-creates everything from scratch.
    Locked (invoiced) milestones are never touched.

    initial_hours = available capacity per person (working days minus holidays, absences,
                    and proportional sick/vacation/training estimates from settings),
                    scaled so that the budget-proportional euro allocation is met.
    current_hours = same as initial_hours on first creation (editable afterwards).

    Budget distribution:
      If total_budget_euros > 0: each month receives euros proportional to its working-day
      count relative to all project working days; initial_hours are scaled accordingly.
      If only total_budget_hours is set: global hours scale (legacy behaviour).
      Otherwise: initial_hours = raw available capacity (no scaling).
    """
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    membership_rate_map: dict[int, float] = {m.person_id: m.billing_rate_per_hour for m in memberships}

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    current_person_ids = {m.person_id for m in memberships}
    all_project_months = _months_in_range(project.start_date, project.end_date)

    # When force=True, delete all unlocked milestones so they get fully re-created below
    if force:
        unlocked = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.is_locked == False,  # noqa: E712
            )
        ).all()
        for ms in unlocked:
            budgets = session.exec(
                select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
            ).all()
            for b in budgets:
                session.delete(b)
            session.delete(ms)
        session.flush()

    # Determine which months need to be created; also find existing milestones needing repair
    new_months: list[tuple[int, int]] = []
    repair_milestones: list[Milestone] = []
    for year, month in all_project_months:
        exists = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.year == year,
                Milestone.month == month,
            )
        ).first()
        if not exists:
            new_months.append((year, month))
        else:
            existing_budgets = session.exec(
                select(MilestonePersonBudget).where(
                    MilestonePersonBudget.milestone_id == exists.id
                )
            ).all()
            existing_person_ids = {b.person_id for b in existing_budgets}
            if current_person_ids - existing_person_ids:
                repair_milestones.append(exists)

    if not new_months and not repair_milestones:
        return []

    # First pass: compute available capacity per person per month
    month_capacity: dict[tuple[int, int], dict[int, float]] = {}
    for year, month in new_months:
        person_hours: dict[int, float] = {}
        for m in memberships:
            person = _get_person(m.person_id)
            if person is None:
                continue
            stats = _person_available_hours(person, m, project, year, month, session)
            if stats.hours > 0:
                person_hours[m.person_id] = person_hours.get(m.person_id, 0.0) + stats.hours
        month_capacity[(year, month)] = person_hours

    # Compute per-month scale factors based on budget allocation strategy
    month_scale: dict[tuple[int, int], float] = {}

    budget_euros = project.total_budget_euros if project.total_budget_euros and project.total_budget_euros > 0 else 0.0
    budget_hours = project.total_budget_hours if project.total_budget_hours and project.total_budget_hours > 0 else 0.0

    if budget_euros > 0:
        # Distribute euro budget proportionally by working-day count per month
        work_days_map: dict[tuple[int, int], int] = {
            (y, mo): _calendar_work_days(y, mo, project.holiday_country, project.holiday_state, session)
            for y, mo in new_months
        }
        total_work_days = sum(work_days_map.values())
        for year, month in new_months:
            work_days = work_days_map.get((year, month), 0)
            if total_work_days == 0 or work_days == 0:
                month_scale[(year, month)] = 0.0
                continue
            plan_euros = budget_euros * (work_days / total_work_days)
            available_cost = sum(
                month_capacity[(year, month)].get(pid, 0.0) * membership_rate_map.get(pid, 0.0)
                for pid in month_capacity[(year, month)]
            )
            month_scale[(year, month)] = (plan_euros / available_cost) if available_cost > 0 else 0.0
    elif budget_hours > 0:
        # Legacy: scale all new months uniformly so total capacity matches hours budget
        total_capacity = sum(sum(ph.values()) for ph in month_capacity.values())
        global_scale = (budget_hours / total_capacity) if total_capacity > budget_hours else 1.0
        for year, month in new_months:
            month_scale[(year, month)] = global_scale
    else:
        for year, month in new_months:
            month_scale[(year, month)] = 1.0

    # Repair existing milestones: sync member budget rows
    for ms in repair_milestones:
        existing_budgets = session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        existing_person_ids = {b.person_id for b in existing_budgets}

        for b in existing_budgets:
            if b.person_id not in current_person_ids:
                session.delete(b)

        for m in memberships:
            if m.person_id in existing_person_ids:
                continue
            person = _get_person(m.person_id)
            if person is None:
                continue
            stats = _person_available_hours(person, m, project, ms.year, ms.month, session)
            if stats.hours > 0:
                session.add(MilestonePersonBudget(
                    milestone_id=ms.id,
                    person_id=m.person_id,
                    initial_hours=stats.hours,
                    current_hours=stats.hours,
                ))

        session.flush()
        all_budgets = session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        new_total = sum(b.current_hours for b in all_budgets)
        ms.current_hours = new_total
        if ms.initial_hours == 0:
            ms.initial_hours = new_total
        session.add(ms)

    # Create new milestone rows
    created: list[Milestone] = []
    for year, month in new_months:
        person_hours = month_capacity[(year, month)]
        scale = month_scale[(year, month)]
        capacity_total = sum(person_hours.values())

        milestone = Milestone(
            project_id=project_id,
            year=year,
            month=month,
            initial_hours=capacity_total * scale,
            current_hours=capacity_total * scale,
        )
        session.add(milestone)
        session.flush()

        for person_id, cap_hours in person_hours.items():
            session.add(MilestonePersonBudget(
                milestone_id=milestone.id,
                person_id=person_id,
                initial_hours=cap_hours * scale,
                current_hours=cap_hours * scale,
            ))

        created.append(milestone)

    session.commit()
    for m in created:
        session.refresh(m)
    return created


def update_person_budget(
    milestone_id: int,
    budget_id: int,
    new_hours: float,
    session: Session,
) -> tuple[MilestonePersonBudget, Milestone]:
    """Update a person's current_hours budget and sync Milestone.current_hours.

    Raises MilestoneLocked if the milestone is locked.
    Raises MilestoneNotFound / BudgetNotFound for missing records.
    Raises ValueError if new_hours < 0 or the budget does not belong to the milestone.
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone:
        raise MilestoneNotFound(f"Milestone {milestone_id} not found.")
    if milestone.is_locked:
        raise MilestoneLocked(f"Milestone {milestone_id} is locked.")

    budget = session.get(MilestonePersonBudget, budget_id)
    if not budget or budget.milestone_id != milestone_id:
        raise BudgetNotFound(f"Budget {budget_id} not found in milestone {milestone_id}.")

    if new_hours < 0:
        raise ValueError("Budget hours cannot be negative.")

    budget.current_hours = new_hours

    all_budgets = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id
        )
    ).all()
    milestone.current_hours = sum(b.current_hours for b in all_budgets)

    session.add(budget)
    session.add(milestone)
    session.commit()
    session.refresh(budget)
    session.refresh(milestone)
    return budget, milestone


def update_person_budget_by_person(
    milestone_id: int,
    person_id: int,
    new_hours: float,
    session: Session,
) -> tuple[MilestonePersonBudget, Milestone]:
    """Update by person_id instead of budget_id. Convenience for the detail view."""
    budget = session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id,
            MilestonePersonBudget.person_id == person_id,
        )
    ).first()
    if not budget:
        raise BudgetNotFound(f"No budget for person {person_id} in milestone {milestone_id}.")
    return update_person_budget(milestone_id, budget.id, new_hours, session)


def _person_hours_in_month(membership: ProjectMembership, year: int, month: int) -> float:
    """Simple capacity calc without holiday/absence deduction (used by rebalancing service)."""
    month_start, month_end = _month_bounds(year, month)
    eff_start = max(membership.from_date, month_start)
    eff_end = min(membership.to_date, month_end)
    if eff_end < eff_start:
        return 0.0
    from app.services.planning import working_days as _working_days
    days = _working_days(eff_start, eff_end)
    return days * (membership.weekly_capacity_hours / 5)


def get_milestone_budgets(milestone_id: int, session: Session) -> list[MilestonePersonBudget]:
    return session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id
        )
    ).all()
