from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.billing import BillingPosition
from app.models.enums import MilestoneStatus
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone
from app.models.project import Project
from app.models.timebooking import TimeBooking

router = APIRouter(prefix="/projects", tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]


# ---------------------------------------------------------------------------
# Create schemas (FK from URL, not body)
# ---------------------------------------------------------------------------

class BillingPositionCreate(SQLModel):
    position_number: str = Field(min_length=1)
    description: str = ""
    budget_euros: float = Field(ge=0)


class MembershipCreate(SQLModel):
    person_id: int
    from_date: str  # date as ISO string; FastAPI converts
    to_date: str
    weekly_capacity_hours: float = Field(gt=0, le=60)
    billing_rate_per_hour: float = Field(ge=0)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectStats(BaseModel):
    project_id: int
    booked_hours: float
    open_milestones: int
    overdue_milestones: int


@router.get("", response_model=list[Project])
def list_projects(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(Project).offset(skip).limit(limit)).all()


@router.get("/stats", response_model=list[ProjectStats])
def get_project_stats(session: SessionDep):
    today = date.today()

    booked_rows = session.exec(
        select(TimeBooking.project_id, func.sum(TimeBooking.net_hours))
        .group_by(TimeBooking.project_id)
    ).all()
    booked_map: dict[int, float] = {pid: float(hrs) for pid, hrs in booked_rows}

    open_ms = session.exec(select(Milestone).where(Milestone.status == MilestoneStatus.open)).all()
    open_count: dict[int, int] = {}
    overdue_count: dict[int, int] = {}
    for ms in open_ms:
        open_count[ms.project_id] = open_count.get(ms.project_id, 0) + 1
        if (ms.year, ms.month) < (today.year, today.month):
            overdue_count[ms.project_id] = overdue_count.get(ms.project_id, 0) + 1

    projects_all = session.exec(select(Project)).all()
    return [
        ProjectStats(
            project_id=p.id,
            booked_hours=booked_map.get(p.id, 0.0),
            open_milestones=open_count.get(p.id, 0),
            overdue_milestones=overdue_count.get(p.id, 0),
        )
        for p in projects_all
    ]


@router.post("", response_model=Project, status_code=201)
def create_project(project: Project, session: SessionDep):
    project.id = None
    try:
        session.add(project)
        session.commit()
        session.refresh(project)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Project number already exists.")
    return project


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    return project


@router.put("/{project_id}", response_model=Project)
def update_project(project_id: int, data: Project, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    update = data.model_dump(exclude_unset=True, exclude={"id"})
    for field, value in update.items():
        setattr(project, field, value)
    try:
        session.add(project)
        session.commit()
        session.refresh(project)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Project number already exists.")
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, session: SessionDep):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found.")
    session.delete(project)
    session.commit()


# ---------------------------------------------------------------------------
# Billing positions
# ---------------------------------------------------------------------------

@router.get("/{project_id}/billing-positions", response_model=list[BillingPosition])
def list_billing_positions(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(BillingPosition).where(BillingPosition.project_id == project_id)
    ).all()


@router.post("/{project_id}/billing-positions", response_model=BillingPosition, status_code=201)
def create_billing_position(project_id: int, body: BillingPositionCreate, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    bp = BillingPosition(
        project_id=project_id,
        position_number=body.position_number,
        description=body.description,
        budget_euros=body.budget_euros,
    )
    session.add(bp)
    session.commit()
    session.refresh(bp)
    return bp


@router.delete("/{project_id}/billing-positions/{bp_id}", status_code=204)
def delete_billing_position(project_id: int, bp_id: int, session: SessionDep):
    bp = session.get(BillingPosition, bp_id)
    if not bp or bp.project_id != project_id:
        raise HTTPException(404, "Billing position not found.")
    session.delete(bp)
    session.commit()


# ---------------------------------------------------------------------------
# Memberships
# ---------------------------------------------------------------------------

@router.get("/{project_id}/memberships", response_model=list[ProjectMembership])
def list_memberships(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)
    ).all()


@router.post("/{project_id}/memberships", response_model=ProjectMembership, status_code=201)
def create_membership(project_id: int, body: MembershipCreate, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    from datetime import date
    membership = ProjectMembership(
        project_id=project_id,
        person_id=body.person_id,
        from_date=date.fromisoformat(body.from_date),
        to_date=date.fromisoformat(body.to_date),
        weekly_capacity_hours=body.weekly_capacity_hours,
        billing_rate_per_hour=body.billing_rate_per_hour,
    )
    try:
        session.add(membership)
        session.commit()
        session.refresh(membership)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Membership already exists for this person and project.")
    return membership


@router.delete("/{project_id}/memberships/{membership_id}", status_code=204)
def delete_membership(project_id: int, membership_id: int, session: SessionDep):
    m = session.get(ProjectMembership, membership_id)
    if not m or m.project_id != project_id:
        raise HTTPException(404, "Membership not found.")
    session.delete(m)
    session.commit()
