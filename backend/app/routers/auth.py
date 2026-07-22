"""Auth routes (doc 25, WP2).

Mounts the fastapi-users login/logout/register/users routers and adds the
admin-only invite-token management endpoints. Password-reset/verify routers are
intentionally omitted for now (admin-assisted reset planned).
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.auth.backend import auth_backend, current_superuser, fastapi_users
from app.auth.manager import utcnow_naive
from app.auth.schemas import UserCreate, UserRead, UserUpdate
from app.db import get_session
from app.models.invite_token import InviteToken
from app.models.user import User

router = APIRouter()

# fastapi-users generated routers.
router.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth", tags=["auth"])
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"]
)
router.include_router(fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"])


# ── Invite-token management (admin only) ─────────────────────────────────────

class InviteCreate(BaseModel):
    expires_in_days: int | None = 14  # None = no expiry


class InviteRead(BaseModel):
    id: int
    token: str
    created_by: int | None
    used_by: int | None
    created_at: str | None
    used_at: str | None
    expires_at: str | None


def _to_read(t: InviteToken) -> InviteRead:
    return InviteRead(
        id=t.id,  # type: ignore[arg-type]
        token=t.token,
        created_by=t.created_by,
        used_by=t.used_by,
        created_at=t.created_at.isoformat() if t.created_at else None,
        used_at=t.used_at.isoformat() if t.used_at else None,
        expires_at=t.expires_at.isoformat() if t.expires_at else None,
    )


invites = APIRouter(prefix="/auth/invites", tags=["auth"])


@invites.post("", response_model=InviteRead, status_code=201)
def create_invite(
    body: InviteCreate,
    session: Session = Depends(get_session),
    admin: User = Depends(current_superuser),
) -> InviteRead:
    now = utcnow_naive()
    expires = now + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    invite = InviteToken(
        token=secrets.token_urlsafe(32),
        created_by=admin.id,
        created_at=now,
        expires_at=expires,
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)
    return _to_read(invite)


@invites.get("", response_model=list[InviteRead])
def list_invites(
    session: Session = Depends(get_session),
    admin: User = Depends(current_superuser),
) -> list[InviteRead]:
    tokens = session.exec(select(InviteToken).order_by(InviteToken.id)).all()
    return [_to_read(t) for t in tokens]


router.include_router(invites)
