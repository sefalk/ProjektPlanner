"""Endpoints for milestone management and per-person budget updates."""
from calendar import monthrange as _monthrange
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import TimeBooking
from app.services.rebalancing import (
    MilestoneSuggestion,
    UtilizationRecommendation,
    compute_recommendations,
    preview_recalculation,
)
from app.services.milestones import (
    BudgetConfirmationRequired,
    BudgetNotFound,
    MilestoneLocked,
    MilestoneNotFound,
    NoActiveMembership,
    PersonMonthStats,
    _months_in_range,
    _parse_work_week_pattern,
    _person_available_hours,
    clear_milestone_target_budget,
    effective_rate,
    get_milestone_budgets,
    initialize_milestones,
    project_positions,
    manual_budget_update,
    manual_budget_update_by_person,
    resync_milestones,
    set_budget_hours_lock,
    set_estimated_absence,
    set_milestone_planning_lock,
    set_milestone_target_budget,
)

router = APIRouter(prefix="/projects", tags=["milestones"])

SessionDep = Annotated[Session, Depends(get_session)]


class BudgetUpdate(SQLModel):
    current_hours: float = Field(ge=0)


class MilestonePersonDetailOut(SQLModel):
    person_id: int
    person_name: str
    budget_id: int
    initial_hours: float
    current_hours: float
    available_hours: float
    days_per_week: float
    work_days: int
    absence_days: int
    estimated_absence_days: float = 0.0
    vacation_estimate_days: float = 0.0
    sick_estimate_days: float = 0.0
    training_estimate_days: float = 0.0
    holiday_days: int
    billing_rate_per_hour: float
    billing_position_id: int | None = None
    booked_hours: float = 0.0
    is_manual_override: bool = False
    estimated_absence_days_override: float | None = None
    # WP6 diagnostics: why this row is planned below its available capacity (else None).
    cap_reason: str | None = None


class MilestoneDetailOut(SQLModel):
    milestone: Milestone
    persons: list[MilestonePersonDetailOut]
    warnings: list[str] = []


class ResyncResultOut(SQLModel):
    added: int
    removed: int
    recomputed: int
    changed_milestone_ids: list[int]


class BudgetUpdateOut(SQLModel):
    """A budget row plus any informational warnings from a manual edit (V6)."""
    id: int
    milestone_id: int
    person_id: int
    initial_hours: float
    current_hours: float
    is_manual_override: bool
    warnings: list[str] = []


class TargetBudgetUpdate(SQLModel):
    target_euros: float = Field(ge=0)


class TargetBudgetOut(SQLModel):
    milestone: Milestone
    achieved_euros: float
    warnings: list[str] = []


class LockUpdate(SQLModel):
    locked: bool


class EstimatedAbsenceUpdate(SQLModel):
    days: float | None = Field(default=None, ge=0)


# ---------------------------------------------------------------------------
# Milestone endpoints (nested under /projects/{project_id})
# ---------------------------------------------------------------------------


@router.post("/{project_id}/milestones/initialize", response_model=list[Milestone], status_code=201)
def init_milestones(project_id: int, session: SessionDep, force: bool = False):
    """Create milestones for all months in the project range.

    force=false (default): existing milestones are skipped; missing member budgets are repaired.
    force=true: all unlocked milestones are deleted and fully re-created.
    Returns only the newly created milestones.
    """
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    try:
        return initialize_milestones(project_id, session, force=force)
    except MilestoneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except NoActiveMembership as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/{project_id}/milestones/resync", response_model=ResyncResultOut)
def resync(project_id: int, session: SessionDep):
    """Non-destructively align open milestones to the current membership state (V5).

    Adds budget rows for newly active members (correctly scaled), removes rows for
    members no longer active, recomputes auto rows against the budget — while preserving
    manually overridden rows and locked months. Unlike initialize?force=true, manual
    edits are kept.
    """
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    try:
        summary = resync_milestones(project_id, session)
    except MilestoneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    return ResyncResultOut(
        added=summary.added,
        removed=summary.removed,
        recomputed=summary.recomputed,
        changed_milestone_ids=summary.changed_milestone_ids,
    )


@router.put(
    "/{project_id}/milestones/{milestone_id}/target-budget",
    response_model=TargetBudgetOut,
)
def set_target_budget(project_id: int, milestone_id: int, body: TargetBudgetUpdate, session: SessionDep):
    """Set a month's € target (sync with the external billing system) and redistribute the
    members' hours to hit it — € leads, hours follow (B1). Only for open (unlocked) months."""
    try:
        milestone, achieved, warnings = set_milestone_target_budget(
            project_id, milestone_id, body.target_euros, session
        )
    except MilestoneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return TargetBudgetOut(milestone=milestone, achieved_euros=achieved, warnings=warnings)


@router.delete("/{project_id}/milestones/{milestone_id}/target-budget", response_model=Milestone)
def clear_target_budget(project_id: int, milestone_id: int, session: SessionDep):
    """Unlock a month's € target — drop it and unlock the month's rows for recomputation."""
    try:
        return clear_milestone_target_budget(project_id, milestone_id, session)
    except MilestoneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc


@router.put(
    "/{project_id}/milestones/{milestone_id}/budgets/{budget_id}/lock",
    response_model=MilestonePersonBudget,
)
def put_hours_lock(project_id: int, milestone_id: int, budget_id: int, body: LockUpdate, session: SessionDep):
    """Lock/unlock one budget row's Soll-hours for the month (locked = preserved by resync)."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        return set_budget_hours_lock(milestone_id, budget_id, body.locked, session)
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc


@router.put(
    "/{project_id}/milestones/{milestone_id}/budgets/{budget_id}/estimated-absence",
    response_model=MilestonePersonBudget,
)
def put_estimated_absence(project_id: int, milestone_id: int, budget_id: int, body: EstimatedAbsenceUpdate, session: SessionDep):
    """Set (or clear, days=null) the manual estimated-absence override for one budget row."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        return set_estimated_absence(milestone_id, budget_id, body.days, session)
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.put("/{project_id}/milestones/{milestone_id}/planning-lock", response_model=Milestone)
def put_planning_lock(project_id: int, milestone_id: int, body: LockUpdate, session: SessionDep):
    """Freeze/unfreeze a whole month for planning (status 'gesperrt') — the recompute
    leaves it untouched. Distinct from closing/invoicing."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        return set_milestone_planning_lock(milestone_id, body.locked, session)
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except MilestoneNotFound as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{project_id}/milestones/detail", response_model=list[MilestoneDetailOut])
def list_milestones_detail(project_id: int, session: SessionDep):
    """Return all milestones with per-person breakdown including day statistics."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")

    milestones = session.exec(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.year, Milestone.month)
    ).all()

    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()
    # Keyed by assignment (person, position) so a multi-assigned person resolves the
    # right membership per budget row (WP2).
    membership_map: dict[tuple[int, int | None], ProjectMembership] = {
        (m.person_id, m.billing_position_id): m for m in memberships
    }
    positions_by_id = project_positions(project_id, session)

    persons_map: dict[int, Person] = {}
    for m in memberships:
        p = session.get(Person, m.person_id)
        if p:
            persons_map[p.id] = p

    valid_months = set(_months_in_range(project.start_date, project.end_date))

    result: list[MilestoneDetailOut] = []
    for ms in milestones:
        budgets = get_milestone_budgets(ms.id, session)
        month_start = date(ms.year, ms.month, 1)
        month_end = date(ms.year, ms.month, _monthrange(ms.year, ms.month)[1])
        booked_rows = session.exec(
            select(TimeBooking.person_id, TimeBooking.billing_position_id, func.sum(TimeBooking.net_hours))
            .where(
                TimeBooking.project_id == project_id,
                TimeBooking.booking_date >= month_start,
                TimeBooking.booking_date <= month_end,
                TimeBooking.is_excluded == False,  # noqa: E712
            )
            .group_by(TimeBooking.person_id, TimeBooking.billing_position_id)
        ).all()
        # Booked hours per assignment (person, position); in simple mode both booking and
        # budget carry billing_position_id = None, so this matches the person's row (WP2).
        booked_map: dict[tuple[int, int | None], float] = {
            (pid, bpid): float(h) for pid, bpid, h in booked_rows
        }
        persons_out: list[MilestonePersonDetailOut] = []
        for budget in budgets:
            person = persons_map.get(budget.person_id)
            membership = membership_map.get((budget.person_id, budget.billing_position_id))
            if person is None or membership is None:
                continue
            stats = _person_available_hours(person, membership, project, ms.year, ms.month, session)
            pattern = _parse_work_week_pattern(person.work_week_pattern) if person.work_week_pattern else None
            days_per_week = float(sum(1 for h in pattern if h > 0)) if pattern else 5.0
            # WP6: a non-override row planned below its available capacity was capped by a
            # budget (capacity itself = available_hours). Name which budget bound it.
            cap_reason: str | None = None
            if not ms.is_locked and not budget.is_manual_override and stats.hours - budget.current_hours > 0.05:
                if project.position_mode and membership.billing_position_id is not None:
                    pos = positions_by_id.get(membership.billing_position_id)
                    posnum = pos.position_number if pos else "?"
                    cap_reason = (
                        f"Nur {budget.current_hours:.1f} von {stats.hours:.1f} h verplant — "
                        f"Budget von Posten '{posnum}' ausgeschöpft."
                    )
                else:
                    cap_reason = (
                        f"Nur {budget.current_hours:.1f} von {stats.hours:.1f} h verplant — "
                        f"Projektbudget ausgeschöpft."
                    )
            persons_out.append(MilestonePersonDetailOut(
                person_id=person.id,
                person_name=person.name,
                budget_id=budget.id,
                initial_hours=budget.initial_hours,
                current_hours=budget.current_hours,
                available_hours=stats.hours,
                days_per_week=days_per_week,
                work_days=stats.work_days,
                absence_days=stats.absence_days,
                estimated_absence_days=stats.estimated_absence_days,
                vacation_estimate_days=stats.vacation_estimate_days,
                sick_estimate_days=stats.sick_estimate_days,
                training_estimate_days=stats.training_estimate_days,
                holiday_days=stats.holiday_days,
                billing_rate_per_hour=effective_rate(membership, positions_by_id),
                billing_position_id=membership.billing_position_id,
                booked_hours=booked_map.get((person.id, budget.billing_position_id), 0.0),
                is_manual_override=budget.is_manual_override,
                estimated_absence_days_override=budget.estimated_absence_days_override,
                cap_reason=cap_reason,
            ))

        # Milestone-level warnings (§8.1 / V11)
        warnings: list[str] = []
        has_active_member = any(
            m.from_date <= month_end and m.to_date >= month_start for m in memberships
        )
        if not ms.is_locked and has_active_member and ms.current_hours == 0:
            warnings.append(
                "Keine planbaren Stunden in diesem Monat trotz zugeordnetem Personal "
                "(volle Abwesenheit oder Budget erschöpft)."
            )
        if ms.is_locked and (ms.year, ms.month) not in valid_months:
            warnings.append(
                "Gesperrter Meilenstein liegt außerhalb des aktuellen Projektzeitraums."
            )

        result.append(MilestoneDetailOut(milestone=ms, persons=persons_out, warnings=warnings))

    return result


@router.get("/{project_id}/milestones/recalc-preview", response_model=list[MilestoneSuggestion])
def get_recalc_preview(project_id: int, session: SessionDep):
    """Read-only preview of what 'Neu berechnen' would set per open milestone (inline hint)."""
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return preview_recalculation(project_id, session)


@router.get(
    "/{project_id}/milestones/recommendations",
    response_model=list[UtilizationRecommendation],
)
def get_recommendations(project_id: int, session: SessionDep):
    """Utilization recommendations (V8, B4): where a member still has untapped general
    weekly capacity and the project has budget headroom, suggest raising the project
    weekly hours. Informational only."""
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return compute_recommendations(project_id, session)


@router.get("/{project_id}/milestones", response_model=list[Milestone])
def list_milestones(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.year, Milestone.month)
    ).all()


@router.get("/{project_id}/milestones/{milestone_id}", response_model=Milestone)
def get_milestone(project_id: int, milestone_id: int, session: SessionDep):
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    return milestone


# ---------------------------------------------------------------------------
# Person budget endpoints (nested under /projects/{project_id}/milestones/{mid})
# ---------------------------------------------------------------------------


@router.get(
    "/{project_id}/milestones/{milestone_id}/budgets",
    response_model=list[MilestonePersonBudget],
)
def list_budgets(project_id: int, milestone_id: int, session: SessionDep):
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    return get_milestone_budgets(milestone_id, session)


def _budget_out(budget: MilestonePersonBudget, warnings: list[str]) -> "BudgetUpdateOut":
    return BudgetUpdateOut(
        id=budget.id,
        milestone_id=budget.milestone_id,
        person_id=budget.person_id,
        initial_hours=budget.initial_hours,
        current_hours=budget.current_hours,
        is_manual_override=budget.is_manual_override,
        warnings=warnings,
    )


@router.put(
    "/{project_id}/milestones/{milestone_id}/budgets/{budget_id}",
    response_model=BudgetUpdateOut,
)
def put_budget(
    project_id: int,
    milestone_id: int,
    budget_id: int,
    body: BudgetUpdate,
    session: SessionDep,
    confirm: bool = False,
):
    """Manually set a person's current_hours (V6, §8.2).

    Without `confirm`, a change that would exceed the project euro budget returns HTTP 409
    with a `warnings` body and is NOT saved. With `confirm=true` it is saved anyway and the
    row is flagged as a manual override. Exceeding available capacity only warns (soft).
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        budget, _, warnings = manual_budget_update(
            milestone_id, budget_id, body.current_hours, session, confirm=confirm
        )
    except BudgetConfirmationRequired as exc:
        raise HTTPException(409, {"message": "Confirmation required.", "warnings": exc.warnings}) from exc
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _budget_out(budget, warnings)


@router.put(
    "/{project_id}/milestones/{milestone_id}/persons/{person_id}",
    response_model=BudgetUpdateOut,
)
def put_person_budget(
    project_id: int,
    milestone_id: int,
    person_id: int,
    body: BudgetUpdate,
    session: SessionDep,
    confirm: bool = False,
):
    """Update a person's current_hours within a milestone by person_id (V6, §8.2).

    Same confirmation semantics as the budget-id variant.
    """
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        budget, _, warnings = manual_budget_update_by_person(
            milestone_id, person_id, body.current_hours, session, confirm=confirm
        )
    except BudgetConfirmationRequired as exc:
        raise HTTPException(409, {"message": "Confirmation required.", "warnings": exc.warnings}) from exc
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _budget_out(budget, warnings)
