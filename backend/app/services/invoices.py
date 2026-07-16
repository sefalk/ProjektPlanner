"""Invoice service — month-close workflow.

close_month():
  - Aggregates TimeBooking.net_hours per person for the given month
  - Creates MonthlyInvoice + InvoicePersonEntry records
  - Locks and closes the associated Milestone (if initialised)
  - Raises AlreadyClosedError if an invoice already exists for that month

reopen_month():
  - Deletes MonthlyInvoice and its InvoicePersonEntry rows
  - Unlocks and re-opens the associated Milestone
  - Only allowed when invoice.status == 'planned'

update_invoice_status():
  - Advances the invoice status (planned → invoiced → paid)
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

from sqlmodel import Session, select

from app.models.billing import BillingPosition
from app.models.enums import InvoiceStatus, MilestoneStatus
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone
from app.models.project import Project
from app.models.timebooking import TimeBooking


class InvoiceError(Exception):
    pass


class AlreadyClosedError(InvoiceError):
    pass


class InvoiceNotFoundError(InvoiceError):
    pass


class InvalidStatusTransitionError(InvoiceError):
    pass


# Valid forward transitions
_TRANSITIONS: dict[InvoiceStatus, set[InvoiceStatus]] = {
    InvoiceStatus.planned: {InvoiceStatus.invoiced},
    InvoiceStatus.invoiced: {InvoiceStatus.paid},
    InvoiceStatus.paid: set(),
}


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


# ---------------------------------------------------------------------------
# Close
# ---------------------------------------------------------------------------


def close_month(
    project_id: int,
    year: int,
    month: int,
    billing_position_id: int,
    session: Session,
) -> list[MonthlyInvoice]:
    """Lock the milestone and create invoice records for a project month.

    Simple mode: one MonthlyInvoice under the chosen billing_position_id (per-member rate).
    Position mode (§21 WP6): one MonthlyInvoice per line item, splitting the month's bookings
    by TimeBooking.billing_position_id at the position's rate; bookings with no position fall
    back to billing_position_id (chosen default). Returns the created invoice(s).

    Raises:
        InvoiceNotFoundError: project or billing_position not found
        AlreadyClosedError: an invoice already exists for this project/year/month
    """
    project = session.get(Project, project_id)
    if not project:
        raise InvoiceNotFoundError(f"Project {project_id} not found.")

    bp = session.get(BillingPosition, billing_position_id)
    if not bp or bp.project_id != project_id:
        raise InvoiceNotFoundError(
            f"BillingPosition {billing_position_id} not found for project {project_id}."
        )

    existing = session.exec(
        select(MonthlyInvoice).where(
            MonthlyInvoice.project_id == project_id,
            MonthlyInvoice.year == year,
            MonthlyInvoice.month == month,
        )
    ).first()
    if existing:
        raise AlreadyClosedError(
            f"Month {year}-{month:02d} for project {project_id} is already closed."
        )

    month_start, month_end = _month_bounds(year, month)

    bookings = session.exec(
        select(TimeBooking).where(
            TimeBooking.project_id == project_id,
            TimeBooking.booking_date >= month_start,
            TimeBooking.booking_date <= month_end,
            TimeBooking.is_excluded == False,  # noqa: E712
        )
    ).all()

    memberships = session.exec(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project_id,
            ProjectMembership.from_date <= month_end,
            ProjectMembership.to_date >= month_start,
        )
    ).all()
    member_rate: dict[int, float] = {m.person_id: m.billing_rate_per_hour for m in memberships}
    positions = session.exec(
        select(BillingPosition).where(BillingPosition.project_id == project_id)
    ).all()
    pos_rate: dict[int, float] = {p.id: p.billing_rate_per_hour for p in positions}

    invoices: list[MonthlyInvoice] = []

    def _create_invoice(pos_id: int, hours_by_person: dict[int, float], rate_by_person: dict[int, float]) -> None:
        total_hours = sum(hours_by_person.values())
        total_amount = sum(h * rate_by_person.get(pid, 0.0) for pid, h in hours_by_person.items())
        invoice = MonthlyInvoice(
            project_id=project_id, billing_position_id=pos_id, year=year, month=month,
            total_hours=total_hours, total_amount_euros=total_amount,
        )
        session.add(invoice)
        session.flush()
        for pid, hours in hours_by_person.items():
            rate = rate_by_person.get(pid, 0.0)
            session.add(InvoicePersonEntry(
                invoice_id=invoice.id, person_id=pid, hours=hours,
                billing_rate_per_hour=rate, amount_euros=hours * rate,
            ))
        invoices.append(invoice)

    if project.position_mode:
        # One invoice per line item; each booking's position (fallback to the chosen default)
        # decides its bucket, and the rate comes from that position (§21 P2/WP6).
        by_position: dict[int, dict[int, float]] = {}
        for b in bookings:
            pos_id = b.billing_position_id if b.billing_position_id in pos_rate else billing_position_id
            by_position.setdefault(pos_id, {})
            by_position[pos_id][b.person_id] = by_position[pos_id].get(b.person_id, 0.0) + b.net_hours
        for pos_id, hours_by_person in by_position.items():
            rate = pos_rate.get(pos_id, 0.0)
            _create_invoice(pos_id, hours_by_person, {pid: rate for pid in hours_by_person})
    else:
        hours_by_person: dict[int, float] = {}
        for b in bookings:
            hours_by_person[b.person_id] = hours_by_person.get(b.person_id, 0.0) + b.net_hours
        _create_invoice(billing_position_id, hours_by_person, member_rate)

    # Lock and close the milestone once for the month (if it was initialised).
    milestone = session.exec(
        select(Milestone).where(
            Milestone.project_id == project_id,
            Milestone.year == year,
            Milestone.month == month,
        )
    ).first()
    if milestone:
        milestone.is_locked = True
        milestone.status = MilestoneStatus.closed
        session.add(milestone)

    session.commit()
    for inv in invoices:
        session.refresh(inv)
    return invoices


# ---------------------------------------------------------------------------
# Reopen
# ---------------------------------------------------------------------------


def reopen_month(invoice_id: int, session: Session) -> None:
    """Reopen the month of the given invoice: unlock the milestone and delete ALL of that
    month's invoices (position mode has one per line item, §21 WP6) with their entries.

    Raises:
        InvoiceNotFoundError: invoice does not exist
    """
    invoice = session.get(MonthlyInvoice, invoice_id)
    if not invoice:
        raise InvoiceNotFoundError(f"Invoice {invoice_id} not found.")

    # Re-open the milestone
    milestone = session.exec(
        select(Milestone).where(
            Milestone.project_id == invoice.project_id,
            Milestone.year == invoice.year,
            Milestone.month == invoice.month,
        )
    ).first()
    if milestone:
        milestone.is_locked = False
        milestone.status = MilestoneStatus.open
        session.add(milestone)

    # Delete every invoice (and its entries) for this project-month.
    month_invoices = session.exec(
        select(MonthlyInvoice).where(
            MonthlyInvoice.project_id == invoice.project_id,
            MonthlyInvoice.year == invoice.year,
            MonthlyInvoice.month == invoice.month,
        )
    ).all()
    for inv in month_invoices:
        for entry in session.exec(
            select(InvoicePersonEntry).where(InvoicePersonEntry.invoice_id == inv.id)
        ).all():
            session.delete(entry)
        session.delete(inv)
    session.commit()


# ---------------------------------------------------------------------------
# Status update
# ---------------------------------------------------------------------------


def update_invoice_status(
    invoice_id: int, new_status: InvoiceStatus, session: Session
) -> MonthlyInvoice:
    """Advance the invoice status (planned → invoiced → paid).

    Raises:
        InvoiceNotFoundError: invoice does not exist
        InvalidStatusTransitionError: invalid status transition
    """
    invoice = session.get(MonthlyInvoice, invoice_id)
    if not invoice:
        raise InvoiceNotFoundError(f"Invoice {invoice_id} not found.")

    allowed = _TRANSITIONS.get(invoice.status, set())
    if new_status not in allowed:
        raise InvalidStatusTransitionError(
            f"Cannot transition from '{invoice.status}' to '{new_status}'."
        )

    invoice.status = new_status
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    return invoice


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


def get_invoice_entries(invoice_id: int, session: Session) -> list[InvoicePersonEntry]:
    return session.exec(
        select(InvoicePersonEntry).where(InvoicePersonEntry.invoice_id == invoice_id)
    ).all()
