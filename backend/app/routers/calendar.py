"""Calendar endpoint — returns one-month overview of holidays, absences, and memberships."""

import calendar as _cal
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from app.db import get_session
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone
from app.models.person import Person, PersonAbsence
from app.models.project import Project
from app.services.holiday import HolidayFetchError, get_holidays_in_range

router = APIRouter(prefix="/calendar", tags=["calendar"])
SessionDep = Annotated[Session, Depends(get_session)]


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class HolidayOut(BaseModel):
    holiday_date: date
    name: str
    is_workday: bool


class AbsenceOut(BaseModel):
    id: int
    start_date: date
    end_date: date | None
    absence_type: str
    status: str


class MembershipOut(BaseModel):
    project_id: int
    project_number: str
    project_name: str
    program_id: int | None
    from_date: date
    to_date: date
    weekly_capacity_hours: float


class PersonOut(BaseModel):
    id: int
    name: str
    default_weekly_hours: float
    absences: list[AbsenceOut]
    memberships: list[MembershipOut]


class MilestoneOut(BaseModel):
    project_id: int
    project_number: str
    year: int
    month: int
    status: str
    is_locked: bool
    initial_hours: float
    current_hours: float


class CalendarResponse(BaseModel):
    year: int
    month: int
    holidays: list[HolidayOut]
    persons: list[PersonOut]
    milestones: list[MilestoneOut]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("", response_model=CalendarResponse)
def get_calendar(
    session: SessionDep,
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    country: str = Query("DE"),
    state: str = Query("BY"),
) -> CalendarResponse:
    last_day = _cal.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)

    # Holidays (best-effort: silently return empty list on fetch failure)
    try:
        raw_holidays = get_holidays_in_range(start, end, country, state, session)
    except HolidayFetchError:
        raw_holidays = []

    holidays = [
        HolidayOut(holiday_date=h.holiday_date, name=h.name, is_workday=h.is_workday)
        for h in sorted(raw_holidays, key=lambda h: h.holiday_date)
    ]

    # All persons (sorted by name)
    persons_raw = list(session.exec(select(Person).order_by(Person.name)).all())
    person_ids = [p.id for p in persons_raw if p.id is not None]

    # Absences overlapping [start, end]
    # Overlaps when: start_date <= month_end AND (end_date IS NULL OR end_date >= month_start)
    absences_raw = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id.in_(person_ids),
            PersonAbsence.start_date <= end,
            or_(PersonAbsence.end_date.is_(None), PersonAbsence.end_date >= start),
        )
    ).all()

    absences_by_person: dict[int, list[AbsenceOut]] = {pid: [] for pid in person_ids}
    for a in absences_raw:
        if a.person_id in absences_by_person and a.id is not None:
            absences_by_person[a.person_id].append(
                AbsenceOut(
                    id=a.id,
                    start_date=a.start_date,
                    end_date=a.end_date,
                    absence_type=a.absence_type.value,
                    status=a.status.value,
                )
            )

    # Memberships overlapping [start, end], joined with Project
    memberships_raw = session.exec(
        select(ProjectMembership, Project)
        .join(Project, ProjectMembership.project_id == Project.id)
        .where(
            ProjectMembership.person_id.in_(person_ids),
            ProjectMembership.from_date <= end,
            ProjectMembership.to_date >= start,
        )
    ).all()

    memberships_by_person: dict[int, list[MembershipOut]] = {pid: [] for pid in person_ids}
    for m, proj in memberships_raw:
        if m.person_id in memberships_by_person:
            memberships_by_person[m.person_id].append(
                MembershipOut(
                    project_id=proj.id,  # type: ignore[arg-type]
                    project_number=proj.project_number,
                    project_name=proj.name,
                    program_id=proj.program_id,
                    from_date=m.from_date,
                    to_date=m.to_date,
                    weekly_capacity_hours=m.weekly_capacity_hours,
                )
            )

    persons_out = [
        PersonOut(
            id=p.id,  # type: ignore[arg-type]
            name=p.name,
            default_weekly_hours=p.default_weekly_hours,
            absences=absences_by_person.get(p.id, []),  # type: ignore[arg-type]
            memberships=memberships_by_person.get(p.id, []),  # type: ignore[arg-type]
        )
        for p in persons_raw
        if p.id is not None
    ]

    # Milestones for this month, joined with Project
    milestones_raw = session.exec(
        select(Milestone, Project)
        .join(Project, Milestone.project_id == Project.id)
        .where(Milestone.year == year, Milestone.month == month)
        .order_by(Project.project_number)
    ).all()

    milestones_out = [
        MilestoneOut(
            project_id=ms.project_id,
            project_number=proj.project_number,
            year=ms.year,
            month=ms.month,
            status=ms.status.value,
            is_locked=ms.is_locked,
            initial_hours=ms.initial_hours,
            current_hours=ms.current_hours,
        )
        for ms, proj in milestones_raw
    ]

    return CalendarResponse(
        year=year,
        month=month,
        holidays=holidays,
        persons=persons_out,
        milestones=milestones_out,
    )
