"""First-admin bootstrap (doc 25, WP2).

Registration requires an invite token, and invite tokens are minted by an
admin — a chicken-and-egg. To break it, if ADMIN_EMAIL + ADMIN_PASSWORD are
configured and NO user exists yet, a superuser is created on startup. Idempotent:
does nothing once any user exists.
"""

from __future__ import annotations

from fastapi_users.password import PasswordHelper
from sqlmodel import Session, select

from app.config import settings
from app.db import engine
from app.models.user import User


def seed_admin_user() -> None:
    if not settings.admin_email or not settings.admin_password:
        return
    with Session(engine) as session:
        if session.exec(select(User)).first() is not None:
            return  # some user already exists — never auto-create again
        hashed = PasswordHelper().hash(settings.admin_password)
        session.add(
            User(
                email=settings.admin_email,
                hashed_password=hashed,
                is_active=True,
                is_superuser=True,
                is_verified=True,
            )
        )
        session.commit()
