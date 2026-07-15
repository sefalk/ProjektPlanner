"""Rebalancing service — drift detection, budget-oriented suggestions, recommendations.

Drift: the difference between what was planned (MilestonePersonBudget.initial_hours)
and what was actually booked (TimeBooking.net_hours) for a given person/project.

Rebalancing suggestions (V7, §6.6): distribute the *remaining* budget
(total − invoiced/locked − already-booked in open months − manual overrides) over the
open milestones and members using the same net-capacity distribution as initialization
(distribute_budget). The goal is to maximally use the budget without exceeding it and
without overbooking any person beyond their available capacity. Unlike the old engine,
the per-milestone total may change (budget filling) and drift (booked hours) is taken
into account. Manual-override rows are kept fixed.

apply_rebalancing() writes the suggestions to the open milestones.

compute_recommendations() (V8, B4) is the inverse of the overbooking check: where a
person still has untapped general weekly capacity AND the project has budget headroom,
it suggests raising that project's weekly hours (informational only).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import TimeBooking
from app.services.milestones import (
    SlotKey,
    _month_bounds,
    _person_available_hours,
    _remaining_euro_budget,
    distribute_budget,
)


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
    total_current_hours: float          # current per-milestone total (before applying)
    suggested_total_hours: float = 0.0  # proposed total after budget-oriented rebalancing
    budgets: list[BudgetSuggestion] = field(default_factory=list)


@dataclass
class UtilizationRecommendation:
    person_id: int
    person_name: str
    free_weekly_hours: float        # default_weekly − Σ committed weekly (all projects)
    budget_headroom_euros: float    # project budget not yet invoiced/planned
    recommended_additional_hours: float  # min(free, budget-covered hours)


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

    # Actual booked hours per person from time bookings (excluded bookings are ignored)
    bookings = session.exec(
        select(TimeBooking).where(
            TimeBooking.project_id == project_id,
            TimeBooking.is_excluded == False,  # noqa: E712
        )
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
    """Budget-oriented, drift-aware rebalancing suggestions (V7, BUG-8/9/10).

    Distributes the remaining budget R = total − invoiced(locked) − already-booked(open)
    − manual-override commitments over the open milestones and members, using the same
    net-capacity distribution as initialization (§6.6). Uses ``_person_available_hours``
    (holiday/absence/pattern-aware) so suggestions match the initial plan (fixes BUG-8);
    the per-milestone total may change to maximally use the budget (fixes BUG-9); booked
    hours reduce R (fixes BUG-10). Manual-override rows are kept fixed and never exceed
    available capacity or the budget.
    """
    project = session.get(Project, project_id)
    if not project:
        return []

    open_milestones = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
        ).order_by(Milestone.year, Milestone.month)
    ).all()
    if not open_milestones:
        return []

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    rate_map = {m.person_id: m.billing_rate_per_hour for m in memberships}
    priorities = {m.person_id: m.priority for m in memberships}
    open_month_set = {(ms.year, ms.month) for ms in open_milestones}

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    rows_by_ms: dict[int, dict[int, MilestonePersonBudget]] = {}
    avail_map: dict[SlotKey, float] = {}
    override_cost = 0.0

    for ms in open_milestones:
        month_start, month_end = _month_bounds(ms.year, ms.month)
        active = [m for m in memberships if m.from_date <= month_end and m.to_date >= month_start]
        rows = {
            b.person_id: b
            for b in session.exec(
                select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
            ).all()
        }
        rows_by_ms[ms.id] = rows
        for m in active:
            b = rows.get(m.person_id)
            if b is not None and b.is_manual_override:
                override_cost += b.current_hours * rate_map.get(m.person_id, 0.0)
                continue
            person = _get_person(m.person_id)
            if person is None:
                continue
            avail = _person_available_hours(person, m, project, ms.year, ms.month, session).hours
            if avail > 0:
                avail_map[(m.person_id, (ms.year, ms.month))] = avail

    # Already-booked cost in open months reduces the distributable budget (drift, BUG-10).
    booked_open_cost = 0.0
    bookings = session.exec(
        select(TimeBooking).where(
            TimeBooking.project_id == project_id,
            TimeBooking.is_excluded == False,  # noqa: E712
        )
    ).all()
    for tb in bookings:
        if (tb.booking_date.year, tb.booking_date.month) in open_month_set:
            booked_open_cost += tb.net_hours * rate_map.get(tb.person_id, 0.0)

    budget_euros = project.total_budget_euros if project.total_budget_euros and project.total_budget_euros > 0 else 0.0
    if budget_euros > 0:
        base = _remaining_euro_budget(project_id, budget_euros, open_month_set, rate_map, session)
        remaining = max(0.0, base - override_cost - booked_open_cost)
        plan = distribute_budget(avail_map, rate_map, priorities, remaining)
    else:
        plan = distribute_budget(avail_map, rate_map, priorities, None)

    suggestions: list[MilestoneSuggestion] = []
    for ms in open_milestones:
        rows = rows_by_ms[ms.id]
        budget_suggestions: list[BudgetSuggestion] = []
        for person_id, budget in rows.items():
            if budget.is_manual_override:
                suggested = budget.current_hours  # fixed commitment
            else:
                suggested = plan.get((person_id, (ms.year, ms.month)), 0.0)
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
            suggested_total_hours=sum(bs.suggested_hours for bs in budget_suggestions),
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

        milestone.current_hours = new_total  # no rounding — full precision (§9.4)
        session.add(milestone)

    session.commit()
    for b in updated:
        session.refresh(b)
    return updated


# ---------------------------------------------------------------------------
# Utilization recommendations (V8, B4)
# ---------------------------------------------------------------------------


def compute_recommendations(project_id: int, session: Session) -> list[UtilizationRecommendation]:
    """Suggest raising a member's project weekly hours where they still have untapped
    general capacity AND the project has budget headroom (V8, B4 — inverse of the
    overbooking check). Informational only; performs no mutation.

    free_weekly_hours   = default_weekly_hours − Σ weekly_capacity_hours of all of the
                          person's memberships overlapping this project's period.
    budget_headroom_euros = total_budget − invoiced(locked) − planned cost of open months.
    recommended_additional_hours = min(free_weekly_hours, budget_headroom / rate).
    Only members with a positive recommendation are returned.
    """
    from app.models.invoice import MonthlyInvoice
    from sqlalchemy import func

    project = session.get(Project, project_id)
    if not project:
        return []

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    if not memberships:
        return []

    rate_map = {m.person_id: m.billing_rate_per_hour for m in memberships}

    invoiced = session.exec(
        select(func.coalesce(func.sum(MonthlyInvoice.total_amount_euros), 0.0)).where(
            MonthlyInvoice.project_id == project_id
        )
    ).one()
    invoiced = float(invoiced or 0.0)

    planned_open = 0.0
    open_ms = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
        )
    ).all()
    for ms in open_ms:
        for b in session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all():
            planned_open += b.current_hours * rate_map.get(b.person_id, 0.0)

    budget_headroom = max(0.0, project.total_budget_euros - invoiced - planned_open)

    recommendations: list[UtilizationRecommendation] = []
    for m in memberships:
        person = session.get(Person, m.person_id)
        if not person or person.default_weekly_hours <= 0:
            continue
        # Σ weekly capacity across ALL of the person's memberships overlapping the project.
        all_memberships = session.exec(
            select(ProjectMembership).where(ProjectMembership.person_id == m.person_id)
        ).all()
        committed_weekly = sum(
            x.weekly_capacity_hours
            for x in all_memberships
            if x.from_date <= project.end_date and x.to_date >= project.start_date
        )
        free = person.default_weekly_hours - committed_weekly
        if free <= 1e-9:
            continue
        rate = m.billing_rate_per_hour
        budget_covered = budget_headroom / rate if rate > 0 else 0.0
        recommended = min(free, budget_covered)
        if recommended <= 1e-9:
            continue
        recommendations.append(UtilizationRecommendation(
            person_id=m.person_id,
            person_name=person.name,
            free_weekly_hours=free,
            budget_headroom_euros=budget_headroom,
            recommended_additional_hours=recommended,
        ))

    return recommendations
