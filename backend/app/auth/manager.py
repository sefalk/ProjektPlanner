"""fastapi-users UserManager with the one-time invite-token registration gate."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from fastapi_users import BaseUserManager, IntegerIDMixin
from fastapi_users.exceptions import InvalidPasswordException
from sqlmodel import select

from app.auth.password_policy import password_problems
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

        Validation order matters: the e-mail domain and invite token are checked,
        then ``super().create`` validates the password and inserts the user. The
        token is marked used only AFTER the user is successfully created, so a
        rejected registration (bad domain, weak password, duplicate e-mail) does
        NOT burn the token (#53, regression-tested).
        """
        self._require_allowed_domain(getattr(user_create, "email", ""))
        invite = self._require_valid_invite(getattr(user_create, "invite_token", ""))
        user = await super().create(user_create, safe=safe, request=request)
        invite.used_by = user.id
        invite.used_at = utcnow_naive()
        self.user_db.session.add(invite)
        self.user_db.session.commit()
        return user

    async def validate_password(self, password: str, user) -> None:
        """Enforce the shared password policy (app/auth/password_policy.py, #53)."""
        problems = password_problems(password)
        if problems:
            raise InvalidPasswordException(reason="Passwort benötigt: " + ", ".join(problems) + ".")

    @staticmethod
    def _require_allowed_domain(email: str) -> None:
        """Reject e-mail domains outside the configured allowlist (#53).

        Empty allowlist = every domain allowed. Comparison is case-insensitive.
        """
        raw = (settings.auth_allowed_email_domains or "").strip()
        if not raw:
            return
        allowed = {d.strip().lower() for d in raw.split(",") if d.strip()}
        domain = email.rsplit("@", 1)[-1].strip().lower() if "@" in email else ""
        if domain not in allowed:
            pretty = ", ".join(sorted(allowed))
            raise HTTPException(400, f"Registrierung nur mit E-Mail-Adressen dieser Domains: {pretty}.")

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
