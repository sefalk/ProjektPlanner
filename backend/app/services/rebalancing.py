"""Recalculation preview + utilization recommendations.

preview_recalculation() is a READ-ONLY preview of what the single non-destructive
recompute ("Neu berechnen" = resync / _align_open_milestones) would set: it distributes
the remaining budget R = total − invoiced(closed) − manual-override commitments over the
open milestones and members via the shared net-capacity distribution (§6.6). Locked
(closed) and planning-locked months and manual-override rows are kept fixed. It does NOT
subtract booked hours of open months (those are execution progress within the plan, not a
separate charge) — so a project already in sync previews unchanged. It only feeds the
inline "Rebalanciert" hint on the milestone page; applying is done by resync_milestones.

compute_recommendations() (V8, B4) is the inverse of the overbooking check: where a person
still has untapped general weekly capacity AND the project has budget headroom, it suggests
raising that project's weekly hours (informational only).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    SlotKey,
    _month_bounds,
    _person_available_hours,
    _remaining_euro_budget,
    build_rate_map,
    distribute_budget,
    distribute_over_positions,
    is_position_mode,
    project_positions,
)


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------


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
# Recalculation preview (read-only)
# ---------------------------------------------------------------------------


def preview_recalculation(project_id: int, session: Session) -> list[MilestoneSuggestion]:
    """Read-only preview of what "Neu berechnen" (resync) would set, per open milestone.

    Distributes the remaining budget R = total − invoiced(closed) − manual-override
    commitments over the open milestones and members via the shared net-capacity
    distribution (§6.6, same as _align_open_milestones). Manual-override rows and
    planning-locked / closed months are kept fixed. Booked hours of OPEN months are NOT
    subtracted — they are execution progress within the plan, not a separate charge (only
    closed/invoiced months reduce R). This makes the preview consistent with the applied
    recompute: for a project already in sync the suggestion equals the current state.
    """
    project = session.get(Project, project_id)
    if not project:
        return []

    open_milestones = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.is_locked == False,  # noqa: E712
            Milestone.is_planning_locked == False,  # noqa: E712
        ).order_by(Milestone.year, Milestone.month)
    ).all()
    if not open_milestones:
        return []

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    positions_by_id = project_positions(project_id, session)
    position_mode = is_position_mode(project)
    rate_map = build_rate_map(memberships, positions_by_id)
    priorities = {m.person_id: m.priority for m in memberships}
    open_month_set = {(ms.year, ms.month) for ms in open_milestones}

    person_cache: dict[int, Person] = {}

    def _get_person(pid: int) -> Person | None:
        if pid not in person_cache:
            person_cache[pid] = session.get(Person, pid)
        return person_cache[pid]

    rows_by_ms: dict[int, dict[int, MilestonePersonBudget]] = {}
    avail_map: dict[SlotKey, float] = {}
    override_rows: list[MilestonePersonBudget] = []
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
                override_rows.append(b)
                override_cost += b.current_hours * rate_map.get(m.person_id, 0.0)
                continue
            person = _get_person(m.person_id)
            if person is None:
                continue
            avail = _person_available_hours(person, m, project, ms.year, ms.month, session).hours
            if avail > 0:
                avail_map[(m.person_id, (ms.year, ms.month))] = avail

    budget_euros = project.total_budget_euros if project.total_budget_euros and project.total_budget_euros > 0 else 0.0
    if position_mode:
        plan = distribute_over_positions(
            avail_map, memberships, positions_by_id, priorities, override_rows,
            open_month_set, project_id, session,
        )
    elif budget_euros > 0:
        base = _remaining_euro_budget(project_id, budget_euros, open_month_set, rate_map, session)
        remaining = max(0.0, base - override_cost)
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
