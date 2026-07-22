"""Application settings endpoints (key/value store + database path management)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.auth.deps import owner_context
from app.db import get_session
from app.models.setting import Setting
from app.services import db_management

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(owner_context)])

SessionDep = Annotated[Session, Depends(get_session)]


class SettingUpdate(SQLModel):
    value: str


class DbPathUpdate(SQLModel):
    directory: str


class DbPathInfo(SQLModel):
    url: str
    path: str
    config_source: str
    cloud_warning: bool


class DbPathResult(SQLModel):
    new_path: str
    restart_required: bool
    cloud_warning: bool


@router.get("", response_model=dict[str, str])
def get_settings(session: SessionDep):
    rows = session.exec(select(Setting)).all()
    return {row.key: row.value for row in rows}


# ---------------------------------------------------------------------------
# Database path — must be defined BEFORE /{key} to avoid route shadowing
# ---------------------------------------------------------------------------


@router.get("/database-path", response_model=DbPathInfo)
def get_database_path():
    """Return the current database file location."""
    return db_management.get_db_info()


@router.put("/database-path", response_model=DbPathResult)
def set_database_path(body: DbPathUpdate):
    """Copy the database to a new directory and update the path pointer.

    The backend must be restarted for the change to take full effect.
    Returns restart_required=True and a cloud_warning flag when the target
    path looks like a cloud-sync folder (OneDrive, Dropbox, etc.).
    """
    try:
        return db_management.set_db_directory(body.directory)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"Kopiervorgang fehlgeschlagen: {exc}") from exc


# ---------------------------------------------------------------------------
# Generic key/value settings — must be AFTER specific routes
# ---------------------------------------------------------------------------


@router.put("/{key}", response_model=Setting)
def update_setting(key: str, body: SettingUpdate, session: SessionDep):
    setting = session.get(Setting, key)
    if not setting:
        raise HTTPException(404, f"Setting '{key}' not found.")
    setting.value = body.value
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
