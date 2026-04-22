"""Rebalancing service — drift detection and budget suggestion engine.

Drift: the difference between what was planned (MilestonePersonBudget.initial_hours)
and what was actually booked (TimeBooking.net_hours) for a given person/project.

Rebalancing suggestions: for each open (unlocked) milestone, redistribute
Milestone.current_hours proportionally among active members based on raw capacity.
This preserves the per-milestone total while normalising the per-person split.

apply_rebalancing() writes the suggestions to the database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlmodel import Session, select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.project import Project
from app.models.timebooking import TimeBooking
from app.services.milestones import _month_bounds, _person_hours_in_month


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------


@dataclass
class PersonDrift:
    person_id: int
    planned_hours: float   # SUM(MilestonePersonBudget.initial_hours) across all milestones
    actual_hours: float    # SUM(TimeBooking.net_hours)
    drift_hours: float     # actual - planned  (positive = over plan, negative = under)


@dataclass
class BudgetSuggestion:
    budget_id: int
    person_id: int
    current_hours: float
    suggested_hours: float


@dataclass
class MilestoneSuggestion:
    milestone_id: int
    year: int
    month: int
    total_current_hours: float
    budgets: list[BudgetSuggestion] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Drift computation
# ---------------------------------------------------------------------------


def compute_drift(project_id: int, session: Session) -> list[PersonDrift]:
    """Return per-person drift across all milestones for the project.

    Drift = actual booked hours − initially planned hours.
    Persons with no bookings and no milestones are excluded.
    """
    # Planned hours per person from milestone budgets
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()
    milestone_ids = [m.id for m in milestones]

    planned: dict[int, float] = {}
    if milestone_ids:
        budgets = session.exec(
            select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id.in_(milestone_ids)  # type: ignore[attr-defined]
            )
        ).all()
        for b in budgets:
            planned[b.person_id] = planned.get(b.person_id, 0.0) + b.initial_hours

    # Actual booked hours per person from time bookings
    bookings = session.exec(
        select(TimeBooking).where(TimeBooking.project_id == project_id)
    ).all()
    actual: dict[int, float] = {}
    for tb in bookings:
        actual[tb.person_id] = actual.get(tb.person_id, 0.0) + tb.net_hours

    # Merge keys
    all_persons = set(planned) | set(actual)
    return [
        PersonDrift(
            person_id=pid,
            planned_hours=planned.get(pid, 0.0),
            actual_hours=actual.get(pid, 0.0),
            drift_hours=actual.get(pid, 0.0) - planned.get(pid, 0.0),
        )
        for pid in sorted(all_persons)
    ]


# ---------------------------------------------------------------------------
# Suggestion engine
# ---------------------------------------------------------------------------


def suggest_rebalancing(project_id: int, session: Session) -> list[MilestoneSuggestion]:
    """For each open (unlocked) milestone, suggest redistributed per-person budgets.

    Suggestions preserve Milestone.current_hours but redistribute it
    proportionally to each member's raw working capacity for that month.

    Milestones with no members or all-zero capacity are left as-is (empty budgets).
    """
    open_milestones = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
        ).order_by(Milestone.year, Milestone.month)
    ).all()

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()

    suggestions: list[MilestoneSuggestion] = []

    for ms in open_milestones:
        # Capacities for each member active this month
        capacities: dict[int, float] = {}  # person_id → raw_hours
        for membership in memberships:
            raw = _person_hours_in_month(membership, ms.year, ms.month)
            if raw > 0:
                capacities[membership.person_id] = raw

        total_capacity = sum(capacities.values())

        # Existing budget rows for this milestone (keyed by person_id)
        existing: dict[int, MilestonePersonBudget] = {
            b.person_id: b
            for b in session.exec(
                select(MilestonePersonBudget).where(
                    MilestonePersonBudget.milestone_id == ms.id
                )
            ).all()
        }

        budget_suggestions: list[BudgetSuggestion] = []
        for person_id, capacity in capacities.items():
            if person_id not in existing:
                continue  # member added after init — skip (re-init required)
            budget = existing[person_id]
            if total_capacity > 0:
                fraction = capacity / total_capacity
                suggested = round(fraction * ms.current_hours, 4)
            else:
                suggested = 0.0
            budget_suggestions.append(BudgetSuggestion(
                budget_id=budget.id,  # type: ignore[arg-type]
                person_id=person_id,
                current_hours=budget.current_hours,
                suggested_hours=suggested,
            ))

        suggestions.append(MilestoneSuggestion(
            milestone_id=ms.id,  # type: ignore[arg-type]
            year=ms.year,
            month=ms.month,
            total_current_hours=ms.current_hours,
            budgets=budget_suggestions,
        ))

    return suggestions


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def apply_rebalancing(project_id: int, session: Session) -> list[MilestonePersonBudget]:
    """Write the suggested rebalancing to all open milestones.

    For each open milestone, updates every MilestonePersonBudget.current_hours
    and re-syncs Milestone.current_hours to the new sum.
    Locked milestones are silently skipped.

    Returns the list of updated MilestonePersonBudget rows.
    """
    suggestions = suggest_rebalancing(project_id, session)
    updated: list[MilestonePersonBudget] = []

    for ms_suggestion in suggestions:
        milestone = session.get(Milestone, ms_suggestion.milestone_id)
        if not milestone or milestone.is_locked:
            continue

        new_total = 0.0
        for bs in ms_suggestion.budgets:
            budget = session.get(MilestonePersonBudget, bs.budget_id)
            if not budget:
                continue
            budget.current_hours = bs.suggested_hours
            new_total += bs.suggested_hours
            session.add(budget)
            updated.append(budget)

        milestone.current_hours = round(new_total, 4)
        session.add(milestone)

    session.commit()
    for b in updated:
        session.refresh(b)
    return updated
