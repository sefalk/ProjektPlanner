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
    project: Project,
    year: int,
    month: int,
    session: Session,
) -> float:
    """Estimate unplanned vacation days for person in a single project month.

    Only called when no specific vacation absences exist for that month.
    Distributes the annual contingent evenly over all project months in that year
    (not remaining months), which avoids compounding estimates across calls.
    """
    contingent = session.exec(
        select(VacationContingent).where(
            VacationContingent.person_id == person_id,
            VacationContingent.year == year,
        )
    ).first()
    if not contingent or contingent.total_days <= 0:
        return 0.0

    # Use total project months in this year as the denominator — stable across calls
    project_months_this_year = [
        (y, m) for y, m in _months_in_range(project.start_date, project.end_date)
        if y == year
    ]
    total_months = len(project_months_this_year)
    if total_months <= 0:
        return 0.0

    return contingent.total_days / total_months


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
        vacation_estimate = _vacation_estimate_for_month(person.id, project, year, month, session)

    net_hours = gross_hours - (abs_days + vacation_estimate) * avg_daily_hours
    return PersonMonthStats(
        hours=max(0.0, net_hours),
        work_days=work_days_count,
        absence_days=int(abs_days),
        holiday_days=holiday_days_count,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def initialize_milestones(project_id: int, session: Session) -> list[Milestone]:
    """Create Milestone + MilestonePersonBudget rows for the full project range.

    Skips months that already have a Milestone (safe to call multiple times).
    Returns the newly created Milestone rows (not the pre-existing ones).

    initial_hours  = available capacity (working days minus holidays and absences).
    current_hours  = capacity scaled down proportionally so that the sum across all
                     new months equals project.total_budget_hours when the raw capacity
                     exceeds the budget.  If capacity <= budget, current_hours == initial_hours.
                     Budget scaling is skipped when any milestones already exist (re-init).
    """
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    # Determine which months need to be created
    new_months: list[tuple[int, int]] = []
    for year, month in _months_in_range(project.start_date, project.end_date):
        exists = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.year == year,
                Milestone.month == month,
            )
        ).first()
        if not exists:
            new_months.append((year, month))

    if not new_months:
        return []

    # First pass: compute capacity per month
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

    # Budget scaling: only on first init; scale down if capacity exceeds budget
    is_first_init = len(new_months) == len(_months_in_range(project.start_date, project.end_date))
    total_capacity = sum(sum(ph.values()) for ph in month_capacity.values())
    budget = project.total_budget_hours
    if is_first_init and budget > 0 and total_capacity > budget:
        scale = budget / total_capacity
    else:
        scale = 1.0

    created: list[Milestone] = []
    for year, month in new_months:
        person_hours = month_capacity[(year, month)]
        capacity_total = sum(person_hours.values())

        milestone = Milestone(
            project_id=project_id,
            year=year,
            month=month,
            initial_hours=capacity_total,
            current_hours=capacity_total * scale,
        )
        session.add(milestone)
        session.flush()

        for person_id, cap_hours in person_hours.items():
            session.add(MilestonePersonBudget(
                milestone_id=milestone.id,
                person_id=person_id,
                initial_hours=cap_hours,
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
