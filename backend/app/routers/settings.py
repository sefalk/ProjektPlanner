"""Application settings endpoints (key/value store)."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models.setting import Setting

router = APIRouter(prefix="/settings", tags=["settings"])

SessionDep = Annotated[Session, Depends(get_session)]


class SettingUpdate(SQLModel):
    value: str


@router.get("", response_model=dict[str, str])
def get_settings(session: SessionDep):
    rows = session.exec(select(Setting)).all()
    return {row.key: row.value for row in rows}


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
