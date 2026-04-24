"""Endpoints for milestone management and per-person budget updates."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    BudgetNotFound,
    MilestoneLocked,
    MilestoneNotFound,
    PersonMonthStats,
    _person_available_hours,
    get_milestone_budgets,
    initialize_milestones,
    update_person_budget,
    update_person_budget_by_person,
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
    work_days: int
    absence_days: int
    holiday_days: int
    billing_rate_per_hour: float


class MilestoneDetailOut(SQLModel):
    milestone: Milestone
    persons: list[MilestonePersonDetailOut]


# ---------------------------------------------------------------------------
# Milestone endpoints (nested under /projects/{project_id})
# ---------------------------------------------------------------------------


@router.post("/{project_id}/milestones/initialize", response_model=list[Milestone], status_code=201)
def init_milestones(project_id: int, session: SessionDep):
    """Create milestones for all months in the project range.

    Safe to call multiple times: existing milestones are not modified.
    Returns only the newly created milestones.
    """
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    try:
        return initialize_milestones(project_id, session)
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
    membership_map: dict[int, ProjectMembership] = {m.person_id: m for m in memberships}

    persons_map: dict[int, Person] = {}
    for m in memberships:
        p = session.get(Person, m.person_id)
        if p:
            persons_map[p.id] = p

    result: list[MilestoneDetailOut] = []
    for ms in milestones:
        budgets = get_milestone_budgets(ms.id, session)
        persons_out: list[MilestonePersonDetailOut] = []
        for budget in budgets:
            person = persons_map.get(budget.person_id)
            membership = membership_map.get(budget.person_id)
            if person is None or membership is None:
                continue
            stats = _person_available_hours(person, membership, project, ms.year, ms.month, session)
            persons_out.append(MilestonePersonDetailOut(
                person_id=person.id,
                person_name=person.name,
                budget_id=budget.id,
                initial_hours=budget.initial_hours,
                current_hours=budget.current_hours,
                work_days=stats.work_days,
                absence_days=stats.absence_days,
                holiday_days=stats.holiday_days,
                billing_rate_per_hour=membership.billing_rate_per_hour,
            ))
        result.append(MilestoneDetailOut(milestone=ms, persons=persons_out))

    return result


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


@router.put(
    "/{project_id}/milestones/{milestone_id}/budgets/{budget_id}",
    response_model=MilestonePersonBudget,
)
def put_budget(
    project_id: int,
    milestone_id: int,
    budget_id: int,
    body: BudgetUpdate,
    session: SessionDep,
):
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        budget, _ = update_person_budget(milestone_id, budget_id, body.current_hours, session)
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return budget


@router.put(
    "/{project_id}/milestones/{milestone_id}/persons/{person_id}",
    response_model=MilestonePersonBudget,
)
def put_person_budget(
    project_id: int,
    milestone_id: int,
    person_id: int,
    body: BudgetUpdate,
    session: SessionDep,
):
    """Update a person's current_hours within a milestone (by person_id)."""
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found.")
    try:
        budget, _ = update_person_budget_by_person(milestone_id, person_id, body.current_hours, session)
    except MilestoneLocked as exc:
        raise HTTPException(409, str(exc)) from exc
    except (MilestoneNotFound, BudgetNotFound) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return budget
