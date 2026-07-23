"""User model — application identity for multi-user tenancy (doc 25, WP1).

Fields mirror the fastapi-users SQLAlchemy user table (id, email,
hashed_password, is_active, is_superuser, is_verified) so WP2 can wire
fastapi-users onto this SQLModel table without a schema rework. An int
primary key is used (not UUID) to match every other FK in the codebase —
`owner_id` on ownable entities references `user.id`.

is_superuser doubles as the admin flag: the central owner-filter (WP3) is
bypassed for superusers so an operator/admin account can see all data
(explicit decision, see doc 25 §1/§6).
"""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class User(ValidatedSQLModel, table=True):
    __tablename__ = "user"

    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True, min_length=3)
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False  # admin: sees all data, bypasses the owner-filter (WP3)
    is_verified: bool = False
