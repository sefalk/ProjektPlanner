"""Endpoints for Sage ERP imports and project name mappings."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.timebooking import ImportBatch, SageProjectMapping
from app.services.importer import (
    ImportResult,
    ParseError,
    UnmatchedPersonsError,
    UnresolvedProjectsError,
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


class MappingCreate(SQLModel):
    sage_project_name: str = Field(min_length=1)
    project_id: int


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
    except UnmatchedPersonsError as exc:
        raise HTTPException(
            422,
            {"detail": "Could not match persons", "unmatched_persons": exc.names},
        ) from exc
    return ImportResultOut(
        batch_ids=result.batch_ids,
        inserted=result.inserted,
        skipped=result.skipped,
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
