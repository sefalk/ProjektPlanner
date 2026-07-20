"""Calendar endpoint — returns one-month overview of holidays, absences, and memberships."""

import calendar as _cal
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from sqlalchemy import func

from app.db import get_session
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence
from app.models.project import Project
from app.models.timebooking import TimeBooking
from app.services.holiday import HolidayFetchError, get_holidays_in_range
from app.services.planning import absence_booking
from app.services.holiday_region import (
    extra_holiday_dates,
    get_active_extra_keys,
    resolve_holiday_region,
)

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
    # What the absence books for the person (working days / hours over its whole range).
    booked_working_days: int = 0
    booked_hours: float = 0.0
    # For vacation only: contingent days consumed after the confirmed-sick (AU) refund.
    contingent_days: float | None = None


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


class MilestonePersonBudgetOut(BaseModel):
    person_id: int
    current_hours: float
    booked_hours: float = 0.0


class MilestoneOut(BaseModel):
    project_id: int
    project_number: str
    year: int
    month: int
    status: str
    is_locked: bool
    initial_hours: float
    current_hours: float
    budgets: list[MilestonePersonBudgetOut] = []


class CalendarResponse(BaseModel):
    year: int
    month: int
    holidays: list[HolidayOut]
    persons: list[PersonOut]
    milestones: list[MilestoneOut]


# ── Year view (absence calendar) ──────────────────────────────────────────────

class YearHolidayOut(BaseModel):
    holiday_date: date
    name: str
    is_workday: bool
    country: str
    state: str


class YearPersonOut(BaseModel):
    id: int
    name: str
    default_weekly_hours: float
    # Effective holiday region for this person (override or inherited global).
    holiday_country: str
    holiday_state: str
    absences: list[AbsenceOut]
    memberships: list[MembershipOut]


class YearCalendarResponse(BaseModel):
    year: int
    country: str
    state: str
    holidays: list[YearHolidayOut]
    persons: list[YearPersonOut]


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

    persons_by_id = {p.id: p for p in persons_raw}
    absences_by_person: dict[int, list[AbsenceOut]] = {pid: [] for pid in person_ids}
    for a in absences_raw:
        if a.person_id in absences_by_person and a.id is not None:
            # Booking metrics use the person's own effective region (honors per-person override).
            booking = absence_booking(persons_by_id[a.person_id], a, session)
            absences_by_person[a.person_id].append(
                AbsenceOut(
                    id=a.id,
                    start_date=a.start_date,
                    end_date=a.end_date,
                    absence_type=a.absence_type.value,
                    status=a.status.value,
                    booked_working_days=booking["working_days"],
                    booked_hours=booking["hours"],
                    contingent_days=booking.get("contingent_days"),
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

    # Bulk-fetch all person budgets for these milestones in one query
    milestone_ids = [ms.id for ms, _ in milestones_raw if ms.id is not None]
    milestone_to_project: dict[int, int] = {
        ms.id: ms.project_id for ms, _ in milestones_raw if ms.id is not None
    }

    budgets_raw = session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id.in_(milestone_ids))
    ).all() if milestone_ids else []

    # Bulk-fetch booked hours per (project_id, person_id) for this month
    project_ids = list({ms.project_id for ms, _ in milestones_raw})
    bookings_raw = session.exec(
        select(TimeBooking.project_id, TimeBooking.person_id, func.sum(TimeBooking.net_hours))
        .where(
            TimeBooking.project_id.in_(project_ids),
            TimeBooking.booking_date >= start,
            TimeBooking.booking_date <= end,
            TimeBooking.is_excluded == False,  # noqa: E712
        )
        .group_by(TimeBooking.project_id, TimeBooking.person_id)
    ).all() if project_ids else []
    booked_map: dict[tuple[int, int], float] = {
        (int(proj_id), int(person_id)): float(hours)
        for proj_id, person_id, hours in bookings_raw
    }

    budgets_by_milestone: dict[int, list[MilestonePersonBudgetOut]] = {mid: [] for mid in milestone_ids}
    for b in budgets_raw:
        if b.milestone_id in budgets_by_milestone:
            proj_id = milestone_to_project.get(b.milestone_id)
            booked = booked_map.get((proj_id, b.person_id), 0.0) if proj_id else 0.0
            budgets_by_milestone[b.milestone_id].append(
                MilestonePersonBudgetOut(
                    person_id=b.person_id,
                    current_hours=b.current_hours,
                    booked_hours=booked,
                )
            )

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
            budgets=budgets_by_milestone.get(ms.id, []),
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


@router.get("/year", response_model=YearCalendarResponse)
def get_calendar_year(
    session: SessionDep,
    year: int = Query(..., ge=2000, le=2100),
    country: str | None = Query(None),
    state: str | None = Query(None),
) -> YearCalendarResponse:
    """Whole-year aggregation for the absence calendar.

    Returns holidays plus every person's absences and memberships that overlap
    the year. Holidays cover the union of every person's effective region
    (per-person override or the global default), each tagged with its country/
    state so the frontend can show and colour them per region. Passing both
    ``country`` and ``state`` forces a single region (manual region filter).
    """
    global_country, global_state = resolve_holiday_region(session)
    forced = country is not None and state is not None

    start = date(year, 1, 1)
    end = date(year, 12, 31)

    persons_raw = list(session.exec(select(Person).order_by(Person.name)).all())
    person_ids = [p.id for p in persons_raw if p.id is not None]

    # Effective region per person + the set of regions we must fetch holidays for.
    person_region: dict[int, tuple[str, str]] = {}
    for p in persons_raw:
        if p.id is not None:
            person_region[p.id] = resolve_holiday_region(session, p)

    if forced:
        regions = {(country, state)}
    else:
        regions = set(person_region.values()) | {(global_country, global_state)}

    # Holidays for every region (best-effort per region).
    holidays: list[YearHolidayOut] = []
    for rc, rs in sorted(regions):
        try:
            raw = get_holidays_in_range(start, end, rc, rs, session)
        except HolidayFetchError:
            raw = []
        for h in raw:
            holidays.append(
                YearHolidayOut(
                    holiday_date=h.holiday_date,
                    name=h.name,
                    is_workday=h.is_workday,
                    country=h.country,
                    state=h.state,
                )
            )

    # Inject activated optional local holidays (WP5) for the global region,
    # skipping dates that region already returned.
    global_dates = {h.holiday_date for h in holidays if (h.country, h.state) == (global_country, global_state)}
    if (global_country, global_state) in regions:
        for name, hdate in extra_holiday_dates(year, get_active_extra_keys(session)):
            if hdate in global_dates:
                continue
            holidays.append(
                YearHolidayOut(
                    holiday_date=hdate,
                    name=name,
                    is_workday=hdate.weekday() < 5,
                    country=global_country,
                    state=global_state,
                )
            )
    holidays.sort(key=lambda h: (h.holiday_date, h.country, h.state))

    # Absences overlapping [start, end]
    absences_raw = session.exec(
        select(PersonAbsence).where(
            PersonAbsence.person_id.in_(person_ids),
            PersonAbsence.start_date <= end,
            or_(PersonAbsence.end_date.is_(None), PersonAbsence.end_date >= start),
        )
    ).all()

    persons_by_id = {p.id: p for p in persons_raw}
    absences_by_person: dict[int, list[AbsenceOut]] = {pid: [] for pid in person_ids}
    for a in absences_raw:
        if a.person_id in absences_by_person and a.id is not None:
            # Booking metrics use the person's own effective region (honors per-person override).
            booking = absence_booking(persons_by_id[a.person_id], a, session)
            absences_by_person[a.person_id].append(
                AbsenceOut(
                    id=a.id,
                    start_date=a.start_date,
                    end_date=a.end_date,
                    absence_type=a.absence_type.value,
                    status=a.status.value,
                    booked_working_days=booking["working_days"],
                    booked_hours=booking["hours"],
                    contingent_days=booking.get("contingent_days"),
                )
            )

    # Memberships overlapping [start, end], joined with Project (for project filter)
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
        YearPersonOut(
            id=p.id,  # type: ignore[arg-type]
            name=p.name,
            default_weekly_hours=p.default_weekly_hours,
            holiday_country=person_region[p.id][0],
            holiday_state=person_region[p.id][1],
            absences=absences_by_person.get(p.id, []),  # type: ignore[arg-type]
            memberships=memberships_by_person.get(p.id, []),  # type: ignore[arg-type]
        )
        for p in persons_raw
        if p.id is not None
    ]

    resp_country, resp_state = (country, state) if forced else (global_country, global_state)
    return YearCalendarResponse(
        year=year,
        country=resp_country,  # type: ignore[arg-type]
        state=resp_state,
        holidays=holidays,
        persons=persons_out,
    )
