"""Milestone service — initialization and invariant enforcement.

Milestones represent one calendar month of planned work for a project.
The core invariant: SUM(MilestonePersonBudget.current_hours) == Milestone.current_hours.

Initialization:
  - One Milestone per calendar month between project.start_date and project.end_date.
  - One MilestonePersonBudget per active ProjectMembership for that month.
  - initial_hours = working weekdays in the effective period × (weekly_capacity_hours / 5).
  - Calling initialize_milestones() again is safe: existing milestones are left untouched.

Budget updates:
  - Updating a MilestonePersonBudget.current_hours automatically syncs Milestone.current_hours.
  - Locked milestones cannot be modified (raises MilestoneLocked).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from sqlmodel import Session, select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.project import Project
from app.services.planning import working_days


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


def _person_hours_in_month(
    membership: ProjectMembership, year: int, month: int
) -> float:
    """Raw working-day capacity for a membership in a given month.

    Effective period = overlap of [membership.from_date, membership.to_date]
    with [month_start, month_end].  No holiday or absence deduction — this
    gives the "planned maximum" used at project setup time.
    """
    month_start, month_end = _month_bounds(year, month)
    eff_start = max(membership.from_date, month_start)
    eff_end = min(membership.to_date, month_end)
    if eff_end < eff_start:
        return 0.0
    days = working_days(eff_start, eff_end)
    return days * (membership.weekly_capacity_hours / 5)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def initialize_milestones(project_id: int, session: Session) -> list[Milestone]:
    """Create Milestone + MilestonePersonBudget rows for the full project range.

    Skips months that already have a Milestone (safe to call multiple times).
    Returns the newly created Milestone rows (not the pre-existing ones).
    """
    project = session.get(Project, project_id)
    if not project:
        raise MilestoneNotFound(f"Project {project_id} not found.")

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()

    created: list[Milestone] = []

    for year, month in _months_in_range(project.start_date, project.end_date):
        # Skip if already initialised
        existing = session.exec(
            select(Milestone).where(
                Milestone.project_id == project_id,
                Milestone.year == year,
                Milestone.month == month,
            )
        ).first()
        if existing:
            continue

        # Compute per-person budgets, aggregating across multiple memberships
        # for the same person (different date ranges or allocations).
        person_hours: dict[int, float] = {}
        for m in memberships:
            hours = _person_hours_in_month(m, year, month)
            if hours > 0:
                person_hours[m.person_id] = person_hours.get(m.person_id, 0.0) + hours

        total_hours = sum(person_hours.values())

        milestone = Milestone(
            project_id=project_id,
            year=year,
            month=month,
            initial_hours=total_hours,
            current_hours=total_hours,
        )
        session.add(milestone)
        session.flush()  # obtain milestone.id

        for person_id, hours in person_hours.items():
            session.add(MilestonePersonBudget(
                milestone_id=milestone.id,
                person_id=person_id,
                initial_hours=hours,
                current_hours=hours,
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

    # Re-compute milestone total from all budgets
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


def get_milestone_budgets(milestone_id: int, session: Session) -> list[MilestonePersonBudget]:
    return session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == milestone_id
        )
    ).all()
