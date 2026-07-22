from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import get_session
from app.models.program import Program
from app.models.project import Project

router = APIRouter(prefix="/programs", tags=["programs"])

SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[Program])
def list_programs(session: SessionDep, skip: int = 0, limit: int = 100):
    return session.exec(select(Program).offset(skip).limit(limit)).all()


@router.post("", response_model=Program, status_code=201)
def create_program(program: Program, session: SessionDep):
    program.id = None
    # App-level duplicate check (doc 25): program_number is unique per-owner. This
    # query is auto-scoped to the current owner by WP3's filter; IntegrityError stays
    # as a race backstop.
    if session.exec(select(Program).where(Program.program_number == program.program_number)).first():
        raise HTTPException(409, "Program number already exists.")
    try:
        session.add(program)
        session.commit()
        session.refresh(program)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Program number already exists.")
    return program


@router.get("/{program_id}/projects", response_model=list[Project])
def get_program_projects(program_id: int, session: SessionDep):
    if not session.get(Program, program_id):
        raise HTTPException(404, "Program not found.")
    return session.exec(select(Project).where(Project.program_id == program_id)).all()


@router.get("/{program_id}", response_model=Program)
def get_program(program_id: int, session: SessionDep):
    program = session.get(Program, program_id)
    if not program:
        raise HTTPException(404, "Program not found.")
    return program


@router.put("/{program_id}", response_model=Program)
def update_program(program_id: int, data: Program, session: SessionDep):
    program = session.get(Program, program_id)
    if not program:
        raise HTTPException(404, "Program not found.")
    update = data.model_dump(exclude_unset=True, exclude={"id"})
    for field, value in update.items():
        setattr(program, field, value)
    # App-level duplicate check (doc 25): reject a program_number already used by
    # another of this owner's programs. Auto-scoped to the owner by WP3's filter.
    dup = session.exec(
        select(Program).where(Program.program_number == program.program_number, Program.id != program_id)
    ).first()
    if dup:
        raise HTTPException(409, "Program number already exists.")
    try:
        session.add(program)
        session.commit()
        session.refresh(program)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Program number already exists.")
    return program


@router.delete("/{program_id}", status_code=204)
def delete_program(program_id: int, session: SessionDep):
    program = session.get(Program, program_id)
    if not program:
        raise HTTPException(404, "Program not found.")
    session.delete(program)
    session.commit()
