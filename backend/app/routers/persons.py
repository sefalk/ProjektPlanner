from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.enums import AbsenceDaySegment, AbsenceStatus, AbsenceType
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.membership import ProjectMembership
from app.models.project import Project
from app.models.setting import Setting
from app.services.planning import absence_booking, absence_summary

router = APIRouter(prefix="/persons", tags=["persons"])

SessionDep = Annotated[Session, Depends(get_session)]


# ---------------------------------------------------------------------------
# Create schemas (FK from URL, not body)
# ---------------------------------------------------------------------------

class AbsenceCreate(SQLModel):
    start_date: date
    end_date: date | None = None
    absence_type: AbsenceType
    status: AbsenceStatus
    note: str = ""
    start_segment: AbsenceDaySegment = AbsenceDaySegment.full
    end_segment: AbsenceDaySegment = AbsenceDaySegment.full


class AbsenceWithBooking(SQLModel):
    """A PersonAbsence plus what it actually books (working days / hours).

    booked_working_days / booked_hours: working days (Mon–Fri ∩ no holiday ∩
    pattern>0) in the absence range and the person's hours over them.
    contingent_days: for vacation only — days that draw down the contingent after
    the confirmed-sick (AU) refund; None for non-vacation types.
    """

    id: int
    start_date: date
    end_date: date | None
    absence_type: AbsenceType
    status: AbsenceStatus
    note: str
    start_segment: AbsenceDaySegment
    end_segment: AbsenceDaySegment
    booked_working_days: float
    booked_hours: float
    contingent_days: float | None = None


class ContingentCreate(SQLModel):
    year: int = Field(ge=2000, le=2100)
    total_days: float = Field(ge=0, le=365)


class PersonWithProjects(SQLModel):
    # Mirrors every Person column (so the persons-table edit form can round-trip
    # them without nulling unshown fields) plus the derived project_numbers.
    id: int
    name: str
    sage_employee_name: str
    default_weekly_hours: float
    work_week_pattern: str | None = None
    default_billing_rate: float | None = None
    holiday_country: str | None = None
    holiday_state: str | None = None
    project_numbers: list[str]


# ---------------------------------------------------------------------------
# Persons
# ---------------------------------------------------------------------------

@router.get("", response_model=list[Person])
def list_persons(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(Person).offset(skip).limit(limit)).all()


@router.get("/with-projects", response_model=list[PersonWithProjects])
def list_persons_with_projects(session: SessionDep):
    all_persons = session.exec(select(Person)).all()
    memberships = session.exec(select(ProjectMembership)).all()
    projects_map = {
        p.id: p.project_number
        for p in session.exec(select(Project)).all()
    }
    person_projects: dict[int, list[str]] = {p.id: [] for p in all_persons}
    for m in memberships:
        if m.person_id in person_projects and m.project_id in projects_map:
            num = projects_map[m.project_id]
            if num not in person_projects[m.person_id]:
                person_projects[m.person_id].append(num)
    return [
        PersonWithProjects(
            **p.model_dump(),
            project_numbers=person_projects.get(p.id, []),
        )
        for p in all_persons
    ]


@router.get("/absence-summary")
def batch_absence_summary(session: SessionDep, year: int | None = None):
    """Per-person absence overview for a year (defaults to the current year).

    Keyed by person_id. Used by the persons table's vacation column. Declared
    before /{person_id} so the literal path wins the route match.
    """
    from datetime import date as _date
    yr = year or _date.today().year
    persons_all = session.exec(select(Person)).all()
    return {p.id: absence_summary(p, yr, session) for p in persons_all if p.id is not None}


@router.post("", response_model=Person, status_code=201)
def create_person(person: Person, session: SessionDep):
    from datetime import date as _date
    person.id = None
    # App-level duplicate check (doc 25): sage_employee_name is unique per-owner. This
    # query is auto-scoped to the current owner by WP3's filter; IntegrityError stays
    # as a race backstop.
    if session.exec(select(Person).where(Person.sage_employee_name == person.sage_employee_name)).first():
        raise HTTPException(409, "sage_employee_name already exists.")
    try:
        session.add(person)
        session.flush()
        # Auto-create vacation contingent for the current year using default_vacation_days setting.
        setting = session.get(Setting, "default_vacation_days")
        default_days = float(setting.value) if setting else 30.0
        current_year = _date.today().year
        contingent = VacationContingent(
            person_id=person.id,
            year=current_year,
            total_days=default_days,
        )
        session.add(contingent)
        session.commit()
        session.refresh(person)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "sage_employee_name already exists.")
    return person


@router.get("/{person_id}", response_model=Person)
def get_person(person_id: int, session: SessionDep):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    return person


@router.put("/{person_id}", response_model=Person)
def update_person(person_id: int, data: Person, session: SessionDep):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    update = data.model_dump(exclude_unset=True, exclude={"id"})
    for field, value in update.items():
        setattr(person, field, value)
    # App-level duplicate check (doc 25): reject a sage_employee_name already used by
    # another of this owner's persons. Auto-scoped to the owner by WP3's filter.
    dup = session.exec(
        select(Person).where(
            Person.sage_employee_name == person.sage_employee_name, Person.id != person_id
        )
    ).first()
    if dup:
        raise HTTPException(409, "sage_employee_name already exists.")
    try:
        session.add(person)
        session.commit()
        session.refresh(person)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "sage_employee_name already exists.")
    return person


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: int, session: SessionDep):
    from app.models.membership import ProjectMembership
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    # SQLite FK enforcement is off; manually cascade-delete related rows.
    for obj in session.exec(select(PersonAbsence).where(PersonAbsence.person_id == person_id)).all():
        session.delete(obj)
    for obj in session.exec(select(VacationContingent).where(VacationContingent.person_id == person_id)).all():
        session.delete(obj)
    for obj in session.exec(select(ProjectMembership).where(ProjectMembership.person_id == person_id)).all():
        session.delete(obj)
    session.delete(person)
    session.commit()


# ---------------------------------------------------------------------------
# Memberships (read + delete from person perspective)
# ---------------------------------------------------------------------------

class PersonMembershipOut(SQLModel):
    id: int
    project_id: int
    project_number: str
    project_name: str
    from_date: date
    to_date: date
    weekly_capacity_hours: float
    billing_rate_per_hour: float
    # Carried so an edit from the person view round-trips them instead of resetting
    # priority (feeds the milestone engine) or unassigning the Posten.
    priority: int
    vacation_days_taken: float
    billing_position_id: int | None


@router.get("/{person_id}/memberships", response_model=list[PersonMembershipOut])
def list_person_memberships(person_id: int, session: SessionDep):
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found.")
    memberships = session.exec(
        select(ProjectMembership).where(ProjectMembership.person_id == person_id)
        .order_by(ProjectMembership.from_date)
    ).all()
    result = []
    for m in memberships:
        proj = session.get(Project, m.project_id)
        if proj:
            result.append(PersonMembershipOut(
                id=m.id,
                project_id=proj.id,
                project_number=proj.project_number,
                project_name=proj.name,
                from_date=m.from_date,
                to_date=m.to_date,
                weekly_capacity_hours=m.weekly_capacity_hours,
                billing_rate_per_hour=m.billing_rate_per_hour,
                priority=m.priority,
                vacation_days_taken=m.vacation_days_taken,
                billing_position_id=m.billing_position_id,
            ))
    return result


# ---------------------------------------------------------------------------
# Absences
# ---------------------------------------------------------------------------

@router.get("/{person_id}/absence-summary")
def person_absence_summary(person_id: int, session: SessionDep, year: int | None = None):
    """Absence overview (categories + vacation taken/planned/open) for one person/year."""
    from datetime import date as _date
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    return absence_summary(person, year or _date.today().year, session)


@router.get("/{person_id}/absences", response_model=list[AbsenceWithBooking])
def list_absences(person_id: int, session: SessionDep):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    rows = session.exec(
        select(PersonAbsence).where(PersonAbsence.person_id == person_id)
    ).all()
    out: list[AbsenceWithBooking] = []
    for a in rows:
        booking = absence_booking(person, a, session)
        out.append(AbsenceWithBooking(
            id=a.id, start_date=a.start_date, end_date=a.end_date,
            absence_type=a.absence_type, status=a.status, note=a.note,
            start_segment=a.start_segment, end_segment=a.end_segment,
            booked_working_days=booking["working_days"],
            booked_hours=booking["hours"],
            contingent_days=booking.get("contingent_days"),
        ))
    return out


@router.post("/{person_id}/absences", response_model=PersonAbsence, status_code=201)
def create_absence(person_id: int, body: AbsenceCreate, session: SessionDep):
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found.")
    try:
        absence = PersonAbsence(
            person_id=person_id,
            start_date=body.start_date,
            end_date=body.end_date,
            absence_type=body.absence_type,
            status=body.status,
            note=body.note,
            start_segment=body.start_segment,
            end_segment=body.end_segment,
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    session.add(absence)
    session.commit()
    session.refresh(absence)
    return absence


@router.put("/{person_id}/absences/{absence_id}", response_model=PersonAbsence)
def update_absence(person_id: int, absence_id: int, body: AbsenceCreate, session: SessionDep):
    absence = session.get(PersonAbsence, absence_id)
    if not absence or absence.person_id != person_id:
        raise HTTPException(404, "Absence not found.")
    try:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(absence, field, value)
        # Re-validate cross-field rules
        absence.validate_type_status_and_dates()
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    session.add(absence)
    session.commit()
    session.refresh(absence)
    return absence


@router.delete("/{person_id}/absences/{absence_id}", status_code=204)
def delete_absence(person_id: int, absence_id: int, session: SessionDep):
    absence = session.get(PersonAbsence, absence_id)
    if not absence or absence.person_id != person_id:
        raise HTTPException(404, "Absence not found.")
    session.delete(absence)
    session.commit()


# ---------------------------------------------------------------------------
# Vacation contingents
# ---------------------------------------------------------------------------

@router.get("/{person_id}/vacation-contingents", response_model=list[VacationContingent])
def list_contingents(person_id: int, session: SessionDep):
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found.")
    return session.exec(
        select(VacationContingent).where(VacationContingent.person_id == person_id)
    ).all()


@router.post("/{person_id}/vacation-contingents", response_model=VacationContingent, status_code=201)
def create_contingent(person_id: int, body: ContingentCreate, session: SessionDep):
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found.")
    contingent = VacationContingent(
        person_id=person_id,
        year=body.year,
        total_days=body.total_days,
    )
    try:
        session.add(contingent)
        session.commit()
        session.refresh(contingent)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Vacation contingent for this year already exists.")
    return contingent


@router.put("/{person_id}/vacation-contingents/{contingent_id}", response_model=VacationContingent)
def update_contingent(person_id: int, contingent_id: int, body: ContingentCreate, session: SessionDep):
    contingent = session.get(VacationContingent, contingent_id)
    if not contingent or contingent.person_id != person_id:
        raise HTTPException(404, "Vacation contingent not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(contingent, field, value)
    session.add(contingent)
    session.commit()
    session.refresh(contingent)
    return contingent


@router.delete("/{person_id}/vacation-contingents/{contingent_id}", status_code=204)
def delete_contingent(person_id: int, contingent_id: int, session: SessionDep):
    contingent = session.get(VacationContingent, contingent_id)
    if not contingent or contingent.person_id != person_id:
        raise HTTPException(404, "Vacation contingent not found.")
    session.delete(contingent)
    session.commit()
