"""Program model — top-level grouping of related sub-projects."""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class Program(ValidatedSQLModel, table=True):
    __tablename__ = "program"

    id: int | None = Field(default=None, primary_key=True)
    program_number: str = Field(unique=True, index=True, min_length=1)
    name: str = Field(min_length=1)
    customer: str = Field(min_length=1)
