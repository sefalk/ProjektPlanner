"""Application-level key/value settings."""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class Setting(ValidatedSQLModel, table=True):
    __tablename__ = "setting"

    key: str = Field(primary_key=True, min_length=1)
    value: str
