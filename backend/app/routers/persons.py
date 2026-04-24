from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.enums import AbsenceStatus, AbsenceType
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.membership import ProjectMembership
from app.models.project import Project
from app.models.setting import Setting

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


class ContingentCreate(SQLModel):
    year: int = Field(ge=2000, le=2100)
    total_days: float = Field(ge=0, le=365)


class PersonWithProjects(SQLModel):
    id: int
    name: str
    sage_employee_name: str
    default_weekly_hours: float
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
            id=p.id,
            name=p.name,
            sage_employee_name=p.sage_employee_name,
            default_weekly_hours=p.default_weekly_hours,
            project_numbers=person_projects.get(p.id, []),
        )
        for p in all_persons
    ]


@router.post("", response_model=Person, status_code=201)
def create_person(person: Person, session: SessionDep):
    from datetime import date as _date
    person.id = None
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
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found.")
    session.delete(person)
    session.commit()


# ---------------------------------------------------------------------------
# Absences
# ---------------------------------------------------------------------------

@router.get("/{person_id}/absences", response_model=list[PersonAbsence])
def list_absences(person_id: int, session: SessionDep):
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found.")
    return session.exec(
        select(PersonAbsence).where(PersonAbsence.person_id == person_id)
    ).all()


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
