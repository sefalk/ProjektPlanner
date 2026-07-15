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
    # planned_hours is derived: SUM(MilestonePersonBudget.initial_hours) — not stored here
