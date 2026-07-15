"""ProjectMembership — links a person to a project for a specific period."""

from datetime import date

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class ProjectMembership(ValidatedSQLModel, table=True):
    __tablename__ = "project_membership"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    from_date: date
    to_date: date
    weekly_capacity_hours: float = Field(gt=0, le=60)
    billing_rate_per_hour: float = Field(ge=0)
    # Project-specific priority for budget distribution (B6):
    #   smaller value = higher priority, equal value = same tier, 0 = neutral (default).
    # When the budget cannot fund full capacity, higher-priority members are funded first.
    priority: int = Field(default=0)
    # Assigned line item (Projektposten). In position mode the effective rate comes from the
    # position (see effective_rate); None = simple mode (use billing_rate_per_hour).
    billing_position_id: int | None = Field(default=None, foreign_key="billing_position.id", index=True)
    # Project-specific already-taken vacation days (flat number, no dates). Subtracted from
    # the person's yearly vacation contingent when estimating unplanned vacation for THIS
    # project — mitigates over-estimation when a member is added late in the year without a
    # known absence history. Only affects this project's availability calc.
    vacation_days_taken: float = Field(default=0.0, ge=0)
    # planned_hours is derived: SUM(MilestonePersonBudget.initial_hours) — not stored here
