"""Endpoints for Sage ERP imports and project name mappings."""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.person import Person
from app.models.timebooking import (
    ImportBatch,
    SagePositionMapping,
    SageProjectMapping,
    TimeBooking,
)
from app.services.importer import (
    ImportResult,
    ParseError,
    UnmatchedPersonsError,
    UnresolvedPositionsError,
    UnresolvedProjectsError,
    backfill_bookings_for_level,
    import_bookings,
)



router = APIRouter(tags=["imports"])

SessionDep = Annotated[Session, Depends(get_session)]


# ---------------------------------------------------------------------------
# Response / create schemas
# ---------------------------------------------------------------------------


class ImportResultOut(SQLModel):
    batch_ids: list[int]
    inserted: int
    skipped: int
    mismatches: list[str] = []  # doc 23 WP4: MA booked on an unassigned Posten


class MappingCreate(SQLModel):
    sage_project_name: str = Field(min_length=1)
    project_id: int


class PositionMappingCreate(SQLModel):
    project_id: int
    sage_project_level: str = Field(min_length=1)
    billing_position_id: int


# ---------------------------------------------------------------------------
# Import endpoint
# ---------------------------------------------------------------------------


@router.post("/imports", response_model=ImportResultOut, status_code=201)
async def post_import(file: UploadFile, session: SessionDep):
    """Upload a Sage ERP CSV export and persist the time bookings.

    Returns 422 with `detail` + `unresolved_projects` / `unmatched_persons` lists
    when the file references unknown project names or unmatched persons.
    """
    content = await file.read()
    try:
        result: ImportResult = import_bookings(
            content, session, source_filename=file.filename
        )
    except ParseError as exc:
        if exc.details:
            raise HTTPException(422, {
                "detail": str(exc),
                "parse_errors": [
                    {"row": d.row, "column": d.column, "message": d.message}
                    for d in exc.details
                ],
            }) from exc
        raise HTTPException(422, str(exc)) from exc
    except UnresolvedProjectsError as exc:
        raise HTTPException(
            422,
            {"detail": "Unresolved Sage project names", "unresolved_projects": exc.names},
        ) from exc
    except UnresolvedPositionsError as exc:
        raise HTTPException(
            422,
            {
                "detail": "Unresolved Sage project levels",
                "unresolved_positions": [
                    {"project_id": pid, "sage_project_level": lvl} for pid, lvl in exc.pairs
                ],
            },
        ) from exc
    except UnmatchedPersonsError as exc:
        raise HTTPException(
            422,
            {"detail": "Could not match persons", "unmatched_persons": exc.names},
        ) from exc
    return ImportResultOut(
        batch_ids=result.batch_ids,
        inserted=result.inserted,
        skipped=result.skipped,
        mismatches=result.mismatches,
    )


@router.get("/imports", response_model=list[ImportBatch])
def list_imports(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(ImportBatch).offset(skip).limit(limit)).all()


@router.get("/imports/{batch_id}", response_model=ImportBatch)
def get_import(batch_id: int, session: SessionDep):
    batch = session.get(ImportBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Import batch not found.")
    return batch


class TimeBookingOut(BaseModel):
    id: int
    booking_date: date
    person_id: int
    person_name: str
    sage_project_name: str
    sage_project_level: str
    net_hours: float
    duration_raw: str
    break_duration: str
    note: str
    is_excluded: bool
    exclusion_reason: str | None
    exclusion_note: str | None


@router.get("/imports/{batch_id}/bookings", response_model=list[TimeBookingOut])
def get_import_bookings(batch_id: int, session: SessionDep):
    batch = session.get(ImportBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Import batch not found.")
    bookings = session.exec(
        select(TimeBooking).where(TimeBooking.import_batch_id == batch_id)
        .order_by(TimeBooking.booking_date, TimeBooking.person_id)
    ).all()
    person_cache: dict[int, str] = {}
    result = []
    for b in bookings:
        if b.person_id not in person_cache:
            p = session.get(Person, b.person_id)
            person_cache[b.person_id] = p.name if p else f"Person {b.person_id}"
        result.append(TimeBookingOut(
            id=b.id,  # type: ignore[arg-type]
            booking_date=b.booking_date,
            person_id=b.person_id,
            person_name=person_cache[b.person_id],
            sage_project_name=b.sage_project_name,
            sage_project_level=b.sage_project_level,
            net_hours=b.net_hours,
            duration_raw=b.duration_raw,
            break_duration=b.break_duration,
            note=b.note,
            is_excluded=b.is_excluded,
            exclusion_reason=b.exclusion_reason,
            exclusion_note=b.exclusion_note,
        ))
    return result


# ---------------------------------------------------------------------------
# Booking flag / correction
# ---------------------------------------------------------------------------


_VALID_REASONS = {"duplicate", "incorrect", "cancelled", "test"}


class BookingFlagUpdate(BaseModel):
    is_excluded: bool
    exclusion_reason: str | None = None
    exclusion_note: str | None = None


@router.put("/bookings/{booking_id}/flag", response_model=TimeBookingOut)
def flag_booking(booking_id: int, body: BookingFlagUpdate, session: SessionDep):
    """Set or clear the exclusion flag on a single time booking.

    When is_excluded=true, exclusion_reason must be one of:
    duplicate, incorrect, cancelled, test.
    When is_excluded=false, reason and note are cleared automatically.
    """
    booking = session.get(TimeBooking, booking_id)
    if not booking:
        raise HTTPException(404, "Booking not found.")

    if body.is_excluded:
        if body.exclusion_reason not in _VALID_REASONS:
            raise HTTPException(
                422,
                f"exclusion_reason must be one of: {sorted(_VALID_REASONS)}",
            )
        booking.is_excluded = True
        booking.exclusion_reason = body.exclusion_reason
        booking.exclusion_note = body.exclusion_note or None
    else:
        booking.is_excluded = False
        booking.exclusion_reason = None
        booking.exclusion_note = None

    session.add(booking)
    session.commit()
    session.refresh(booking)

    person = session.get(Person, booking.person_id)
    person_name = person.name if person else f"Person {booking.person_id}"

    return TimeBookingOut(
        id=booking.id,  # type: ignore[arg-type]
        booking_date=booking.booking_date,
        person_id=booking.person_id,
        person_name=person_name,
        sage_project_name=booking.sage_project_name,
        sage_project_level=booking.sage_project_level,
        net_hours=booking.net_hours,
        duration_raw=booking.duration_raw,
        break_duration=booking.break_duration,
        note=booking.note,
        is_excluded=booking.is_excluded,
        exclusion_reason=booking.exclusion_reason,
        exclusion_note=booking.exclusion_note,
    )


# ---------------------------------------------------------------------------
# Sage project mappings
# ---------------------------------------------------------------------------


@router.get("/sage-project-mappings", response_model=list[SageProjectMapping])
def list_mappings(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(SageProjectMapping).offset(skip).limit(limit)).all()


@router.post("/sage-project-mappings", response_model=SageProjectMapping, status_code=201)
def create_mapping(body: MappingCreate, session: SessionDep):
    mapping = SageProjectMapping(
        sage_project_name=body.sage_project_name,
        project_id=body.project_id,
    )
    try:
        session.add(mapping)
        session.commit()
        session.refresh(mapping)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Mapping for this sage_project_name already exists.")
    return mapping


@router.get("/sage-project-mappings/{mapping_id}", response_model=SageProjectMapping)
def get_mapping(mapping_id: int, session: SessionDep):
    mapping = session.get(SageProjectMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found.")
    return mapping


@router.put("/sage-project-mappings/{mapping_id}", response_model=SageProjectMapping)
def update_mapping(mapping_id: int, body: MappingCreate, session: SessionDep):
    mapping = session.get(SageProjectMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found.")
    mapping.sage_project_name = body.sage_project_name
    mapping.project_id = body.project_id
    try:
        session.add(mapping)
        session.commit()
        session.refresh(mapping)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Mapping for this sage_project_name already exists.")
    return mapping


@router.delete("/sage-project-mappings/{mapping_id}", status_code=204)
def delete_mapping(mapping_id: int, session: SessionDep):
    mapping = session.get(SageProjectMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found.")
    session.delete(mapping)
    session.commit()


# ---------------------------------------------------------------------------
# Sage position (level → line item) mappings (§21 P6)
# ---------------------------------------------------------------------------


@router.get("/sage-position-mappings", response_model=list[SagePositionMapping])
def list_position_mappings(session: SessionDep, project_id: int | None = None):
    stmt = select(SagePositionMapping)
    if project_id is not None:
        stmt = stmt.where(SagePositionMapping.project_id == project_id)
    return session.exec(stmt).all()


@router.post("/sage-position-mappings", response_model=SagePositionMapping, status_code=201)
def create_position_mapping(body: PositionMappingCreate, session: SessionDep):
    mapping = SagePositionMapping(
        project_id=body.project_id,
        sage_project_level=body.sage_project_level,
        billing_position_id=body.billing_position_id,
    )
    try:
        session.add(mapping)
        session.commit()
        session.refresh(mapping)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Mapping for this project and level already exists.")
    # doc 24 IP4: apply the new mapping to already-imported bookings of this level.
    backfill_bookings_for_level(mapping.project_id, mapping.sage_project_level, mapping.billing_position_id, session)
    return mapping


@router.put("/sage-position-mappings/{mapping_id}", response_model=SagePositionMapping)
def update_position_mapping(mapping_id: int, body: PositionMappingCreate, session: SessionDep):
    mapping = session.get(SagePositionMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found.")
    old_level = mapping.sage_project_level
    mapping.project_id = body.project_id
    mapping.sage_project_level = body.sage_project_level
    mapping.billing_position_id = body.billing_position_id
    try:
        session.add(mapping)
        session.commit()
        session.refresh(mapping)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Mapping for this project and level already exists.")
    # doc 24 IP4: re-resolve bookings. If the level was renamed, clear the old level's bookings.
    if old_level != mapping.sage_project_level:
        backfill_bookings_for_level(mapping.project_id, old_level, None, session)
    backfill_bookings_for_level(mapping.project_id, mapping.sage_project_level, mapping.billing_position_id, session)
    return mapping


@router.delete("/sage-position-mappings/{mapping_id}", status_code=204)
def delete_position_mapping(mapping_id: int, session: SessionDep):
    mapping = session.get(SagePositionMapping, mapping_id)
    if not mapping:
        raise HTTPException(404, "Mapping not found.")
    project_id, level = mapping.project_id, mapping.sage_project_level
    session.delete(mapping)
    session.commit()
    # doc 24 IP4: bookings of this level become unresolved again.
    backfill_bookings_for_level(project_id, level, None, session)
