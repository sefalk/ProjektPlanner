"""InviteToken — one-time registration gate (doc 25, WP1/§4).

Registration is only possible with a valid, unused, unexpired token: the admin
mints a token (created_by), it is consumed on first successful registration
(used_by / used_at). No SMTP is involved — the admin hands the token to the
invitee out of band. This is global admin/registration infrastructure, not
tenant data, so it carries NO owner_id.
"""

from datetime import datetime

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class InviteToken(ValidatedSQLModel, table=True):
    __tablename__ = "invite_token"

    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(unique=True, index=True, min_length=1)
    created_by: int | None = Field(default=None, foreign_key="user.id")
    used_by: int | None = Field(default=None, foreign_key="user.id")
    created_at: datetime | None = None
    used_at: datetime | None = None
    expires_at: datetime | None = None
