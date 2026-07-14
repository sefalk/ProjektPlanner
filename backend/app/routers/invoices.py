"""Month-close workflow endpoints."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models.enums import InvoiceStatus
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.project import Project
from app.services.invoices import (
    AlreadyClosedError,
    InvoiceNotFoundError,
    InvalidStatusTransitionError,
    close_month,
    get_invoice_entries,
    reopen_month,
    update_invoice_amount,
    update_invoice_status,
)

router = APIRouter(tags=["invoices"])

SessionDep = Annotated[Session, Depends(get_session)]


class CloseRequest(SQLModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    billing_position_id: int


class StatusUpdate(SQLModel):
    status: InvoiceStatus


class AmountUpdate(SQLModel):
    total_amount_euros: float = Field(ge=0)
    total_hours: float | None = Field(default=None, ge=0)


# ---------------------------------------------------------------------------
# Close / reopen
# ---------------------------------------------------------------------------


@router.post("/projects/{project_id}/invoices/close", response_model=MonthlyInvoice, status_code=201)
def close(project_id: int, body: CloseRequest, session: SessionDep):
    """Lock the milestone and generate invoice records for a project month."""
    try:
        return close_month(project_id, body.year, body.month, body.billing_position_id, session)
    except InvoiceNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except AlreadyClosedError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int, session: SessionDep):
    """Reopen a month: unlock the milestone and delete the invoice."""
    try:
        reopen_month(invoice_id, session)
    except InvoiceNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except InvalidStatusTransitionError as exc:
        raise HTTPException(409, str(exc)) from exc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


@router.get("/projects/{project_id}/invoices", response_model=list[MonthlyInvoice])
def list_invoices(project_id: int, session: SessionDep):
    if not session.get(Project, project_id):
        raise HTTPException(404, "Project not found.")
    return session.exec(
        select(MonthlyInvoice).where(MonthlyInvoice.project_id == project_id)
    ).all()


@router.get("/invoices/{invoice_id}", response_model=MonthlyInvoice)
def get_invoice(invoice_id: int, session: SessionDep):
    invoice = session.get(MonthlyInvoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found.")
    return invoice


@router.get("/invoices/{invoice_id}/entries", response_model=list[InvoicePersonEntry])
def list_entries(invoice_id: int, session: SessionDep):
    if not session.get(MonthlyInvoice, invoice_id):
        raise HTTPException(404, "Invoice not found.")
    return get_invoice_entries(invoice_id, session)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@router.put("/invoices/{invoice_id}/status", response_model=MonthlyInvoice)
def set_status(invoice_id: int, body: StatusUpdate, session: SessionDep):
    """Advance invoice status: planned → invoiced → paid."""
    try:
        return update_invoice_status(invoice_id, body.status, session)
    except InvoiceNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except InvalidStatusTransitionError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.put("/invoices/{invoice_id}/amount", response_model=MonthlyInvoice)
def set_amount(invoice_id: int, body: AmountUpdate, session: SessionDep):
    """Adjust the invoiced (Ist) amount of a closed month to sync with the external
    billing system (F4). Feeds the remaining-budget calculation."""
    try:
        return update_invoice_amount(invoice_id, body.total_amount_euros, body.total_hours, session)
    except InvoiceNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
