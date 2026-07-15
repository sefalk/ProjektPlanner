"""BillingPosition — PSP-Element / contract line item defining the budget in euros."""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class BillingPosition(ValidatedSQLModel, table=True):
    __tablename__ = "billing_position"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    position_number: str = Field(min_length=1)
    description: str = ""
    budget_euros: float = Field(ge=0)
    # Hourly rate of this line item (Projektposten). 0 = no rate (simple invoicing position).
    # In "position mode" (project has priced positions) members are assigned to a position
    # and the effective rate comes from here; hours = budget_euros / billing_rate_per_hour.
    billing_rate_per_hour: float = Field(default=0.0, ge=0)
    # SUM(budget_euros) across all positions = effective total € budget for the project
