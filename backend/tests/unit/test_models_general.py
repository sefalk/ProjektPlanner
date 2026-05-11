"""
Smoke tests: every model accepts valid minimal input and rejects missing required fields.
"""

from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from app.models.billing import BillingPosition
from app.models.enums import AbsenceStatus, AbsenceType, InvoiceStatus, ProjectStatus
from app.models.holiday import Holiday
from app.models.invoice import InvoicePersonEntry, MonthlyInvoice
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.program import Program
from app.models.project import Project
from app.models.timebooking import ImportBatch, SageProjectMapping, TimeBooking


def test_program_valid() -> None:
    p = Program(program_number="P00000", name="Test Program", customer="ACME")
    assert p.program_number == "P00000"


def test_project_valid() -> None:
    p = Project(
        project_number="P00001",
        name="Test Project",
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        total_budget_euros=50000.0,
        total_budget_hours=500.0,
    )
    assert p.status == ProjectStatus.active
    assert p.holiday_country == "DE"
    assert p.holiday_state == "BY"


def test_project_requires_positive_budget() -> None:
    with pytest.raises(ValidationError):
        Project(
            project_number="P00001",
            name="X",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            total_budget_euros=10000.0,
            total_budget_hours=0.0,
        )


def test_project_end_must_be_after_start() -> None:
    with pytest.raises(ValidationError):
        Project(
            project_number="P00001",
            name="X",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 1, 1),
            total_budget_euros=10000.0,
            total_budget_hours=100.0,
        )


def test_billing_position_valid() -> None:
    bp = BillingPosition(project_id=1, position_number="Pos1", description="SW Dev", budget_euros=50_000.0)
    assert bp.budget_euros == 50_000.0


def test_billing_position_rejects_negative_budget() -> None:
    with pytest.raises(ValidationError):
        BillingPosition(project_id=1, position_number="P1", description="X", budget_euros=-1.0)


def test_project_membership_valid() -> None:
    pm = ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 6, 30),
        weekly_capacity_hours=28.0, billing_rate_per_hour=96.75,
    )
    assert pm.billing_rate_per_hour == 96.75


def test_project_membership_rejects_zero_capacity() -> None:
    with pytest.raises(ValidationError):
        ProjectMembership(
            project_id=1, person_id=1,
            from_date=date(2026, 1, 1), to_date=date(2026, 6, 30),
            weekly_capacity_hours=0.0, billing_rate_per_hour=96.75,
        )


def test_monthly_invoice_valid() -> None:
    inv = MonthlyInvoice(
        project_id=1, billing_position_id=1,
        year=2026, month=4,
        total_hours=80.0, total_amount_euros=7_740.0,
    )
    assert inv.status == InvoiceStatus.planned
    assert not inv.is_locked


def test_invoice_person_entry_valid() -> None:
    entry = InvoicePersonEntry(
        invoice_id=1, person_id=1,
        hours=40.0, billing_rate_per_hour=96.75, amount_euros=3_870.0,
    )
    assert entry.amount_euros == 3_870.0


def test_import_batch_valid() -> None:
    batch = ImportBatch(
        project_id=1,
        imported_at=datetime(2026, 4, 22, 10, 0, tzinfo=timezone.utc),
        last_booking_date=date(2026, 4, 21),
    )
    assert batch.source_filename is None


def test_sage_project_mapping_valid() -> None:
    m = SageProjectMapping(sage_project_name="PRJ-001 Analytics 2026", project_id=1)
    assert m.project_id == 1


def test_time_booking_valid() -> None:
    tb = TimeBooking(
        booking_date=date(2026, 4, 15),
        person_id=1, project_id=1, import_batch_id=1,
        sage_project_name="PRJ-001 Analytics 2026",
        sage_project_level="Analytics",
        net_hours=4.5,
    )
    assert tb.net_hours == 4.5


def test_time_booking_rejects_negative_hours() -> None:
    with pytest.raises(ValidationError):
        TimeBooking(
            booking_date=date(2026, 4, 15),
            person_id=1, project_id=1, import_batch_id=1,
            sage_project_name="X", sage_project_level="Y",
            net_hours=-1.0,
        )


def test_holiday_valid() -> None:
    h = Holiday(holiday_date=date(2026, 1, 1), name="Neujahr", country="DE", state="BY", is_workday=True)
    assert h.is_workday
