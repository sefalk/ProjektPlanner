"""Request dependency that guards a CRUD router and binds its owner (doc 25, WP3).

Attaching ``dependencies=[Depends(owner_context)]`` to a router does two things
at once for every request it serves:

1. Requires an authenticated, active user (401 otherwise) — the actual access
   boundary for owned data.
2. Binds that user onto the request's Session (``tenancy.bind_owner``) so the
   central ``do_orm_execute`` / ``before_flush`` listeners scope all reads and
   stamp all inserts to this owner — without any per-query code.

Superusers are bound with ``is_superuser=True`` and consequently bypass the read
filter (see ``app/tenancy.py``).
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlmodel import Session

from app.auth.backend import current_active_user
from app.db import get_session
from app.models.user import User
from app.tenancy import bind_owner


def owner_context(
    user: User = Depends(current_active_user),
    session: Session = Depends(get_session),
) -> User:
    """Authenticate the caller and bind them as the session's owner."""
    bind_owner(session, user_id=user.id, is_superuser=user.is_superuser)  # type: ignore[arg-type]
    return user


def require_superuser(user: User = Depends(owner_context)) -> User:
    """Guard for instance-wide, admin-only actions (#53).

    Builds on ``owner_context`` (so it also binds the owner and is covered by the
    test suite's single dependency override) and additionally requires the admin
    flag. Use as a per-route dependency on routers already bound to owner_context.
    """
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="Diese Aktion ist Administratoren vorbehalten.")
    return user
