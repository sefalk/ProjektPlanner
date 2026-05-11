"""MonthlyInvoice and InvoicePersonEntry — billing records created on milestone close."""

from sqlmodel import Field

from app.models.base import ValidatedSQLModel
from app.models.enums import InvoiceStatus


class MonthlyInvoice(ValidatedSQLModel, table=True):
    """Created automatically when a Milestone is closed.

    is_locked mirrors the parent Milestone.is_locked and protects invoice
    records from accidental changes after billing.
    """

    __tablename__ = "monthly_invoice"

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    billing_position_id: int = Field(foreign_key="billing_position.id")
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    total_hours: float = Field(ge=0)
    total_amount_euros: float = Field(ge=0)
    status: InvoiceStatus = InvoiceStatus.planned
    is_locked: bool = False


class InvoicePersonEntry(ValidatedSQLModel, table=True):
    """Breakdown of a MonthlyInvoice by person."""

    __tablename__ = "invoice_person_entry"

    id: int | None = Field(default=None, primary_key=True)
    invoice_id: int = Field(foreign_key="monthly_invoice.id", index=True)
    person_id: int = Field(foreign_key="person.id", index=True)
    hours: float = Field(ge=0)
    billing_rate_per_hour: float = Field(ge=0)
    amount_euros: float = Field(ge=0)
