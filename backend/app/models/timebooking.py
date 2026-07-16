"""TimeBooking, ImportBatch, and SageProjectMapping models."""

from datetime import date, datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class ImportBatch(ValidatedSQLModel, table=True):
    """Records each Sage ERP import event.

    last_booking_date is used by the month-close check to warn if bookings
    after the last import date may be missing.
    """

    __tablename__ = "import_batch"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    imported_at: datetime
    source_filename: str | None = None  # null when data was pasted
    last_booking_date: date


class SageProjectMapping(ValidatedSQLModel, table=True):
    """Maps a Sage project name string to an internal Project.

    Created the first time an unknown sage_project_name is encountered
    during import; subsequent imports resolve it automatically.
    """

    __tablename__ = "sage_project_mapping"

    id: int | None = Field(default=None, primary_key=True)
    sage_project_name: str = Field(unique=True, index=True, min_length=1)
    project_id: int = Field(foreign_key="project.id", index=True)


class SagePositionMapping(ValidatedSQLModel, table=True):
    """Maps a Sage "Projektebene 1" (sage_project_level) to a line item (BillingPosition)
    within a project. Used at import to link a booking to its position (position mode)."""

    __tablename__ = "sage_position_mapping"
    __table_args__ = (
        UniqueConstraint("project_id", "sage_project_level", name="uq_sage_position_project_level"),
    )

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    sage_project_level: str = Field(min_length=1)
    billing_position_id: int = Field(foreign_key="billing_position.id", index=True)


class TimeBooking(ValidatedSQLModel, table=True):
    """Single time booking row imported from a Sage ERP export.

    net_hours is the canonical field used in all calculations.
    duration_raw and break_duration are stored as strings for display only.

    The UNIQUE constraint prevents duplicate rows when the same export
    is imported more than once.
    """

    __tablename__ = "time_booking"
    __table_args__ = (
        UniqueConstraint(
            "booking_date", "person_id", "project_id", "sage_project_level", "net_hours",
            name="uq_time_booking_dedup",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    booking_date: date = Field(index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    import_batch_id: int = Field(foreign_key="import_batch.id")
    sage_project_name: str
    sage_project_level: str
    # Resolved line item (from sage_project_level via SagePositionMapping); None = simple mode.
    billing_position_id: int | None = Field(default=None, foreign_key="billing_position.id", index=True)
    net_hours: float = Field(ge=0)
    duration_raw: str = ""   # e.g. "4:30h" — display only, not used in calculations
    break_duration: str = "" # e.g. "0:30h" — display only
    note: str = ""           # Bemerkung field from Sage CSV
    is_excluded: bool = False
    exclusion_reason: str | None = None  # 'duplicate' | 'incorrect' | 'cancelled' | 'test'
    exclusion_note: str | None = None
