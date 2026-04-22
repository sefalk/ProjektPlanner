"""Endpoints for milestone management and per-person budget updates."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.project import Project
from app.services.milestones import (
    BudgetNotFound,
    MilestoneLocked,
    MilestoneNotFound,
    get_milestone_budgets,
    initialize_milestones,
    update_person_budget,
)

router = APIRouter(prefix="/projects", tags=["milestones"])

SessionDep = Annotated[Session, Depends(get_session)]


class BudgetUpdate(SQLModel):
    current_hours: float = Field(ge=0)


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
