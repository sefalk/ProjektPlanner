"""Unit tests for the invoice / month-close service."""
from datetime import date, datetime

import pytest

from app.models.billing import BillingPosition
from app.models.enums import InvoiceStatus, MilestoneStatus
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import ImportBatch, TimeBooking
from app.services.invoices import (
    AlreadyClosedError,
    InvoiceNotFoundError,
    InvalidStatusTransitionError,
    close_month,
    get_invoice_entries,
    reopen_month,
    update_invoice_status,
)
from app.services.milestones import initialize_milestones


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, number="P00001"):
    p = Project(
        project_number=number,
        name=f"Project {number}",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 3, 31),
        total_budget_euros=50000.0,
        total_budget_hours=500.0,
    )
    session.add(p)
    session.flush()
    return p


def _person(session, name="Max Mustermann"):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _billing_position(session, project_id, number="BP1"):
    bp = BillingPosition(
        project_id=project_id,
        position_number=number,
        description="SW Dev",
        budget_euros=50000.0,
    )
    session.add(bp)
    session.flush()
    return bp


def _membership(session, project_id, person_id, rate=90.0):
    m = ProjectMembership(
        project_id=project_id,
        person_id=person_id,
        from_date=date(2026, 1, 1),
        to_date=date(2026, 3, 31),
        weekly_capacity_hours=40.0,
        billing_rate_per_hour=rate,
    )
    session.add(m)
    session.flush()
    return m


def _booking(session, project_id, person_id, booking_date, net_hours):
    batch = session.exec(
        __import__("sqlmodel").select(ImportBatch).where(ImportBatch.project_id == project_id)
    ).first()
    if not batch:
        batch = ImportBatch(
            project_id=project_id,
            imported_at=datetime(2026, 1, 31),
            last_booking_date=booking_date,
        )
        session.add(batch)
        session.flush()
    tb = TimeBooking(
        booking_date=booking_date,
        person_id=person_id,
        project_id=project_id,
        import_batch_id=batch.id,
        sage_project_name="P00001",
        sage_project_level="Dev",
        net_hours=net_hours,
    )
    session.add(tb)
    session.flush()
    return tb


def _setup(session):
    proj = _project(session)
    person = _person(session)
    bp = _billing_position(session, proj.id)
    _membership(session, proj.id, person.id, rate=90.0)
    session.commit()
    return proj, person, bp


# ---------------------------------------------------------------------------
# close_month
# ---------------------------------------------------------------------------


def test_close_creates_invoice(session):
    proj, person, bp = _setup(session)
    _booking(session, proj.id, person.id, date(2026, 1, 15), 8.0)
    session.commit()

    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]

    assert inv.id is not None
    assert inv.total_hours == 8.0
    assert inv.total_amount_euros == pytest.approx(8.0 * 90.0)
    assert inv.status == InvoiceStatus.planned


def test_close_locks_milestone(session):
    proj, person, bp = _setup(session)
    initialize_milestones(proj.id, session)

    close_month(proj.id, 2026, 1, bp.id, session)

    ms = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.project_id == proj.id, Milestone.month == 1
        )
    ).first()
    assert ms.is_locked is True
    assert ms.status == MilestoneStatus.closed


def test_close_creates_person_entries(session):
    proj, person, bp = _setup(session)
    _booking(session, proj.id, person.id, date(2026, 1, 10), 4.0)
    _booking(session, proj.id, person.id, date(2026, 1, 20), 4.0)
    session.commit()

    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    entries = get_invoice_entries(inv.id, session)

    assert len(entries) == 1
    assert entries[0].hours == 8.0
    assert entries[0].billing_rate_per_hour == 90.0
    assert entries[0].amount_euros == pytest.approx(720.0)


def test_close_zero_bookings(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    assert inv.total_hours == 0.0
    assert inv.total_amount_euros == 0.0


def test_close_multiple_persons(session):
    proj = _project(session)
    alice = _person(session, "Alice")
    bob = _person(session, "Bob")
    bp = _billing_position(session, proj.id)
    _membership(session, proj.id, alice.id, rate=90.0)
    _membership(session, proj.id, bob.id, rate=100.0)
    _booking(session, proj.id, alice.id, date(2026, 1, 5), 8.0)
    _booking(session, proj.id, bob.id, date(2026, 1, 5), 4.0)
    session.commit()

    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]

    assert inv.total_hours == 12.0
    assert inv.total_amount_euros == pytest.approx(8.0 * 90 + 4.0 * 100)
    entries = get_invoice_entries(inv.id, session)
    assert len(entries) == 2


def test_close_already_closed_raises(session):
    proj, person, bp = _setup(session)
    close_month(proj.id, 2026, 1, bp.id, session)
    with pytest.raises(AlreadyClosedError):
        close_month(proj.id, 2026, 1, bp.id, session)


def test_close_project_not_found(session):
    with pytest.raises(InvoiceNotFoundError):
        close_month(9999, 2026, 1, 1, session)


def test_close_billing_position_not_found(session):
    proj = _project(session)
    session.commit()
    with pytest.raises(InvoiceNotFoundError):
        close_month(proj.id, 2026, 1, 9999, session)


def test_close_billing_position_wrong_project(session):
    proj1 = _project(session, "P00001")
    proj2 = _project(session, "P00002")
    bp2 = _billing_position(session, proj2.id)
    session.commit()
    with pytest.raises(InvoiceNotFoundError):
        close_month(proj1.id, 2026, 1, bp2.id, session)


# ---------------------------------------------------------------------------
# reopen_month
# ---------------------------------------------------------------------------


def test_reopen_deletes_invoice(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    reopen_month(inv.id, session)
    assert session.get(MonthlyInvoice, inv.id) is None


def test_reopen_unlocks_milestone(session):
    proj, person, bp = _setup(session)
    initialize_milestones(proj.id, session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    reopen_month(inv.id, session)

    ms = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.project_id == proj.id, Milestone.month == 1
        )
    ).first()
    assert ms.is_locked is False
    assert ms.status == MilestoneStatus.open


def test_reopen_deletes_entries(session):
    proj, person, bp = _setup(session)
    _booking(session, proj.id, person.id, date(2026, 1, 5), 8.0)
    session.commit()
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    reopen_month(inv.id, session)

    entries = session.exec(
        __import__("sqlmodel").select(InvoicePersonEntry)
    ).all()
    assert entries == []


def test_reopen_invoiced_succeeds(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    update_invoice_status(inv.id, InvoiceStatus.invoiced, session)
    reopen_month(inv.id, session)  # must not raise


def test_reopen_not_found(session):
    with pytest.raises(InvoiceNotFoundError):
        reopen_month(9999, session)


# ---------------------------------------------------------------------------
# update_invoice_status
# ---------------------------------------------------------------------------


def test_status_planned_to_invoiced(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    updated = update_invoice_status(inv.id, InvoiceStatus.invoiced, session)
    assert updated.status == InvoiceStatus.invoiced


def test_status_invoiced_to_paid(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    update_invoice_status(inv.id, InvoiceStatus.invoiced, session)
    updated = update_invoice_status(inv.id, InvoiceStatus.paid, session)
    assert updated.status == InvoiceStatus.paid


def test_status_cannot_skip_invoiced(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    with pytest.raises(InvalidStatusTransitionError):
        update_invoice_status(inv.id, InvoiceStatus.paid, session)


def test_status_cannot_go_backwards(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    update_invoice_status(inv.id, InvoiceStatus.invoiced, session)
    with pytest.raises(InvalidStatusTransitionError):
        update_invoice_status(inv.id, InvoiceStatus.planned, session)


def test_status_paid_is_terminal(session):
    proj, person, bp = _setup(session)
    inv = close_month(proj.id, 2026, 1, bp.id, session)[0]
    update_invoice_status(inv.id, InvoiceStatus.invoiced, session)
    update_invoice_status(inv.id, InvoiceStatus.paid, session)
    with pytest.raises(InvalidStatusTransitionError):
        update_invoice_status(inv.id, InvoiceStatus.paid, session)


def test_status_not_found(session):
    with pytest.raises(InvoiceNotFoundError):
        update_invoice_status(9999, InvoiceStatus.invoiced, session)


# ---------------------------------------------------------------------------
# Position mode (§21 WP6): one invoice per line item
# ---------------------------------------------------------------------------


def _priced_position(session, project_id, number, rate, budget):
    bp = BillingPosition(project_id=project_id, position_number=number,
                         budget_euros=budget, billing_rate_per_hour=rate)
    session.add(bp)
    session.flush()
    return bp


def _booking_pos(session, project_id, person_id, booking_date, net_hours, level, position_id):
    batch = session.exec(
        __import__("sqlmodel").select(ImportBatch).where(ImportBatch.project_id == project_id)
    ).first()
    if not batch:
        batch = ImportBatch(project_id=project_id, imported_at=datetime(2026, 1, 31),
                            last_booking_date=booking_date)
        session.add(batch)
        session.flush()
    tb = TimeBooking(
        booking_date=booking_date, person_id=person_id, project_id=project_id,
        import_batch_id=batch.id, sage_project_name="P00001", sage_project_level=level,
        billing_position_id=position_id, net_hours=net_hours,
    )
    session.add(tb)
    session.flush()
    return tb


def test_position_mode_close_creates_one_invoice_per_position(session):
    proj = Project(project_number="PM01", name="PM", start_date=date(2026, 1, 1),
                   end_date=date(2026, 3, 31), total_budget_euros=30000.0, position_mode=True)
    session.add(proj); session.flush()
    pos_a = _priced_position(session, proj.id, "A", rate=100.0, budget=20000.0)
    pos_b = _priced_position(session, proj.id, "B", rate=50.0, budget=10000.0)
    anna = _person(session, "Anna")
    bert = _person(session, "Bert")
    _membership(session, proj.id, anna.id, rate=0.0)
    _membership(session, proj.id, bert.id, rate=0.0)
    _booking_pos(session, proj.id, anna.id, date(2026, 1, 10), 5.0, "Senior", pos_a.id)
    _booking_pos(session, proj.id, bert.id, date(2026, 1, 12), 4.0, "Junior", pos_b.id)
    session.commit()

    invoices = close_month(proj.id, 2026, 1, pos_a.id, session)
    assert len(invoices) == 2
    by_pos = {inv.billing_position_id: inv for inv in invoices}
    assert by_pos[pos_a.id].total_amount_euros == pytest.approx(5.0 * 100.0)  # position rate
    assert by_pos[pos_b.id].total_amount_euros == pytest.approx(4.0 * 50.0)


def test_position_mode_reopen_removes_all_month_invoices(session):
    proj = Project(project_number="PM02", name="PM", start_date=date(2026, 1, 1),
                   end_date=date(2026, 3, 31), total_budget_euros=30000.0, position_mode=True)
    session.add(proj); session.flush()
    pos_a = _priced_position(session, proj.id, "A", rate=100.0, budget=20000.0)
    pos_b = _priced_position(session, proj.id, "B", rate=50.0, budget=10000.0)
    anna = _person(session, "Anna")
    _membership(session, proj.id, anna.id, rate=0.0)
    _booking_pos(session, proj.id, anna.id, date(2026, 1, 10), 5.0, "Senior", pos_a.id)
    _booking_pos(session, proj.id, anna.id, date(2026, 1, 11), 4.0, "Junior", pos_b.id)
    session.commit()

    invoices = close_month(proj.id, 2026, 1, pos_a.id, session)
    assert len(invoices) == 2
    reopen_month(invoices[0].id, session)
    remaining = session.exec(
        __import__("sqlmodel").select(MonthlyInvoice).where(MonthlyInvoice.project_id == proj.id)
    ).all()
    assert remaining == []
