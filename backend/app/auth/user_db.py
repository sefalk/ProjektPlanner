"""Synchronous fastapi-users user database backed by the sync SQLModel Session.

Implements the fastapi-users BaseUserDatabase protocol. Methods are declared
async (the manager awaits them) but execute plain synchronous Session queries —
the app has no async engine and SQLite calls are fast enough for this
low-traffic internal tool.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from fastapi import Depends
from fastapi_users.db.base import BaseUserDatabase
from sqlmodel import Session, select

from app.db import get_session
from app.models.user import User

_USER_COLUMNS = set(User.__table__.columns.keys())  # type: ignore[attr-defined]


class SQLModelUserDatabase(BaseUserDatabase[User, int]):
    """Sync-backed user store for fastapi-users."""

    def __init__(self, session: Session) -> None:
        self.session = session

    async def get(self, id: int) -> User | None:
        return self.session.get(User, id)

    async def get_by_email(self, email: str) -> User | None:
        # Case-insensitive lookup: e-mail addresses are not case-sensitive.
        stmt = select(User).where(User.email == email)
        user = self.session.exec(stmt).first()
        if user is not None:
            return user
        return self.session.exec(
            select(User).where(User.email.ilike(email))  # type: ignore[attr-defined]
        ).first()

    async def get_by_oauth_account(self, oauth: str, account_id: str) -> User | None:
        return None  # OAuth not used

    async def create(self, create_dict: dict[str, Any]) -> User:
        # Drop any keys that are not real User columns (e.g. the invite_token
        # carried on the registration schema).
        data = {k: v for k, v in create_dict.items() if k in _USER_COLUMNS}
        user = User(**data)
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    async def update(self, user: User, update_dict: dict[str, Any]) -> User:
        for key, value in update_dict.items():
            if key in _USER_COLUMNS:
                setattr(user, key, value)
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    async def delete(self, user: User) -> None:
        self.session.delete(user)
        self.session.commit()


def get_user_db(session: Session = Depends(get_session)) -> Generator[SQLModelUserDatabase, None, None]:
    yield SQLModelUserDatabase(session)
