"""Program model — top-level grouping of related sub-projects."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class Program(ValidatedSQLModel, table=True):
    __tablename__ = "program"
    # Multi-user (doc 25): program_number is unique PER OWNER, not globally, so two
    # users may use the same number without one leaking the other's existence.
    __table_args__ = (
        UniqueConstraint("owner_id", "program_number", name="uq_program_owner_number"),
    )

    id: int | None = Field(default=None, primary_key=True)
    # owner_id (doc 25): the user who owns this row. Nullable for now — WP3 sets it
    # automatically on insert and enforces the owner-filter; a later migration can
    # tighten it to NOT NULL once every row is provably owned.
    owner_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    program_number: str = Field(index=True, min_length=1)
    name: str = Field(min_length=1)
    customer: str = Field(min_length=1)
