"""Application-level key/value settings — per owner (doc 25, WP3 step 3b)."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class Setting(ValidatedSQLModel, table=True):
    __tablename__ = "setting"
    # Multi-user (doc 25): settings are per-owner. A surrogate id is the PK (a
    # composite (owner_id, key) PK can't work — owner_id is nullable) and each key
    # is unique PER OWNER, so every user keeps their own copy of the defaults.
    __table_args__ = (
        UniqueConstraint("owner_id", "key", name="uq_setting_owner_key"),
    )

    id: int | None = Field(default=None, primary_key=True)
    owner_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    key: str = Field(index=True, min_length=1)
    value: str
