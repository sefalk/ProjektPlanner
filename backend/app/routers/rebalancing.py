"""Endpoints for project rebalancing: drift reporting and budget adjustment."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.db import get_session
from app.models.project import Project
from app.services.rebalancing import (
    BudgetSuggestion,
    MilestoneSuggestion,
    PersonDrift,
    apply_rebalancing,
    compute_drift,
    suggest_rebalancing,
)

router = APIRouter(prefix="/projects", tags=["rebalancing"])

SessionDep = Annotated[Session, Depends(get_session)]


def _require_project(project_id: int, session: Session) -> None:
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")


@router.get("/{project_id}/rebalancing/drift", response_model=list[PersonDrift])
def get_drift(project_id: int, session: SessionDep):
    """Return per-person drift (actual − planned hours) across all milestones."""
    _require_project(project_id, session)
    return compute_drift(project_id, session)


@router.get("/{project_id}/rebalancing/suggestions", response_model=list[MilestoneSuggestion])
def get_suggestions(project_id: int, session: SessionDep):
    """Return suggested per-person budget adjustments for all open milestones."""
    _require_project(project_id, session)
    return suggest_rebalancing(project_id, session)


@router.post("/{project_id}/rebalancing/apply", response_model=list[dict])
def apply(project_id: int, session: SessionDep):
    """Apply the suggested rebalancing to all open (unlocked) milestones.

    Returns a list of updated budget records with id, person_id, and new current_hours.
    """
    _require_project(project_id, session)
    updated = apply_rebalancing(project_id, session)
    return [
        {"id": b.id, "person_id": b.person_id, "current_hours": b.current_hours}
        for b in updated
    ]
