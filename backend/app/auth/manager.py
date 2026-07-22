"""fastapi-users UserManager with the one-time invite-token registration gate."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from fastapi_users import BaseUserManager, IntegerIDMixin
from sqlmodel import select

from app.auth.user_db import SQLModelUserDatabase, get_user_db
from app.config import settings
from app.models.invite_token import InviteToken
from app.models.user import User


def utcnow_naive() -> datetime:
    """Naive UTC timestamp — matches how SQLite returns stored datetimes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserManager(IntegerIDMixin, BaseUserManager[User, int]):
    reset_password_token_secret = settings.auth_secret
    verification_token_secret = settings.auth_secret

    user_db: SQLModelUserDatabase  # narrowed from BaseUserDatabase

    async def create(self, user_create, safe: bool = False, request: Request | None = None) -> User:
        """Consume a valid one-time invite token, then create the user.

        The token is validated BEFORE creating the user and marked used only
        after the user is successfully created, so a failed registration does
        not burn the token.
        """
        invite = self._require_valid_invite(getattr(user_create, "invite_token", ""))
        user = await super().create(user_create, safe=safe, request=request)
        invite.used_by = user.id
        invite.used_at = utcnow_naive()
        self.user_db.session.add(invite)
        self.user_db.session.commit()
        return user

    def _require_valid_invite(self, token: str) -> InviteToken:
        token = (token or "").strip()
        if not token:
            raise HTTPException(400, "An invite token is required to register.")
        invite = self.user_db.session.exec(
            select(InviteToken).where(InviteToken.token == token)
        ).first()
        if invite is None:
            raise HTTPException(400, "Invalid invite token.")
        if invite.used_by is not None:
            raise HTTPException(400, "This invite token has already been used.")
        if invite.expires_at is not None and invite.expires_at < utcnow_naive():
            raise HTTPException(400, "This invite token has expired.")
        return invite

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        pass  # hook kept for future audit logging


def get_user_manager(user_db: SQLModelUserDatabase = Depends(get_user_db)):
    yield UserManager(user_db)
