"""BillingPosition — PSP-Element / contract line item defining the budget in euros."""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class BillingPosition(ValidatedSQLModel, table=True):
    __tablename__ = "billing_position"

    id: int | None = Field(default=None, primary_key=True)
    # owner_id (doc 25): denormalised owner of the parent project.
    owner_id: int | None = Field(default=None, foreign_key="user.id", index=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    position_number: str = Field(min_length=1)
    description: str = ""
    budget_euros: float = Field(ge=0)
    # Hourly rate of this line item (Projektposten). 0 = no rate (simple invoicing position).
    # In "position mode" (project has priced positions) members are assigned to a position
    # and the effective rate comes from here; hours = budget_euros / billing_rate_per_hour.
    billing_rate_per_hour: float = Field(default=0.0, ge=0)
    # SUM(budget_euros) across all positions = effective total € budget for the project
    #
    # Asymmetric overrun (doc 23, WP3): False = hard cap (teuer, darf nicht überschritten
    # werden — the automatic distribution never plans past budget_euros). True = überschreitbar
    # (günstig, darf über Budget) — the distribution funds this position to full assignment
    # capacity even beyond its budget, so cheaper hours can absorb what expensive positions
    # cannot. Default False keeps the pre-WP3 behavior (every position hard-capped).
    overrunnable: bool = Field(default=False)
