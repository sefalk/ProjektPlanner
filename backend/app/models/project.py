"""Project model — one contract period / sub-project."""

from datetime import date

from pydantic import model_validator
from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel
from app.models.enums import ProjectStatus


class Project(ValidatedSQLModel, table=True):
    __tablename__ = "project"
    # Multi-user (doc 25): project_number is unique PER OWNER, not globally.
    __table_args__ = (
        UniqueConstraint("owner_id", "project_number", name="uq_project_owner_number"),
    )

    id: int | None = Field(default=None, primary_key=True)
    # owner_id (doc 25): owning user; nullable now, populated + enforced in WP3.
    owner_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    program_id: int | None = Field(default=None, foreign_key="program.id", index=True)
    project_number: str = Field(index=True, min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    start_date: date
    end_date: date
    total_budget_hours: float | None = Field(default=None, gt=0)
    total_budget_euros: float = Field(gt=0)
    holiday_country: str = "DE"
    holiday_state: str = "BY"
    status: ProjectStatus = ProjectStatus.active
    # Per-project overrides for the annual sick/training richtwerte (days per calendar year).
    # None = use the global setting; a value (incl. 0 = disabled) overrides it for this project.
    sick_days_per_year_override: float | None = Field(default=None, ge=0)
    training_days_per_year_override: float | None = Field(default=None, ge=0)
    # Projektposten-Modus (§21 WP8): explicit opt-in. When True, budget distribution,
    # member-assignment validation, import level-mapping and invoicing all run per line
    # item. Guarded on enable: every active member assigned + Σ Posten-Budget == total.
    position_mode: bool = Field(default=False)

    @model_validator(mode="after")
    def end_date_after_start(self) -> "Project":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be >= start_date")
        return self
