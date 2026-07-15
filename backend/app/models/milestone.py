"""Milestone and MilestonePersonBudget models."""

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel
from app.models.enums import MilestoneStatus


class Milestone(ValidatedSQLModel, table=True):
    """Monthly hours commitment for a project.

    initial_hours is set at project creation and never changed after any
    milestone in the project is closed — it is the immutable historical reference.
    current_hours is updated by the rebalancing service.

    Invariant (enforced by service layer):
        SUM(MilestonePersonBudget.current_hours) == Milestone.current_hours
    """

    __tablename__ = "milestone"
    __table_args__ = (
        UniqueConstraint("project_id", "year", "month", name="uq_milestone_project_year_month"),
    )

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    initial_hours: float = Field(ge=0)
    current_hours: float = Field(ge=0)
    status: MilestoneStatus = MilestoneStatus.open
    is_locked: bool = False
    # Explicit monthly € target (synced with the external billing system). When set, the
    # month's hours are (re)distributed to hit it (B1: € leads, hours follow). None = the
    # target is derived from the global budget distribution.
    target_budget_euros: float | None = Field(default=None, ge=0)


class MilestonePersonBudget(ValidatedSQLModel, table=True):
    """Per-person hour split within a milestone.

    Must sum to the parent Milestone.current_hours (invariant enforced by service).
    """

    __tablename__ = "milestone_person_budget"
    __table_args__ = (
        UniqueConstraint("milestone_id", "person_id", name="uq_mpb_milestone_person"),
    )

    id: int | None = Field(default=None, primary_key=True)
    milestone_id: int = Field(foreign_key="milestone.id", index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    initial_hours: float = Field(ge=0)
    current_hours: float = Field(ge=0)
    # V5/B6: when True, this row's hours are locked — manually set and preserved by
    # resync/rebalancing/init-repair (until explicitly unlocked, then recompute may change them).
    is_manual_override: bool = False
    # Manual override for the estimated (unplanned) absence days of this person/month.
    # None = auto-estimate (remaining vacation pro-rata + flat sick/training). When set it
    # is used for the availability calc and is preserved (locked) across recomputations.
    estimated_absence_days_override: float | None = Field(default=None, ge=0)
