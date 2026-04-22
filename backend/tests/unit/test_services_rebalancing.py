"""Unit tests for the rebalancing service."""
from datetime import date, datetime

import pytest

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import ImportBatch, SageProjectMapping, TimeBooking
from app.services.milestones import initialize_milestones
from app.services.rebalancing import apply_rebalancing, compute_drift, suggest_rebalancing


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, start=date(2026, 1, 1), end=date(2026, 2, 28), number="P00001"):
    p = Project(
        project_number=number,
        name=f"Project {number}",
        start_date=start,
        end_date=end,
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


def _membership(session, project_id, person_id, weekly_hours=40.0,
                from_date=date(2026, 1, 1), to_date=date(2026, 2, 28)):
    m = ProjectMembership(
        project_id=project_id, person_id=person_id,
        from_date=from_date, to_date=to_date,
        weekly_capacity_hours=weekly_hours, billing_rate_per_hour=90.0,
    )
    session.add(m)
    session.flush()
    return m


def _booking(session, project_id, person_id, booking_date, net_hours):
    # We need an import batch first
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


def _setup(session, weekly_hours_a=40.0, weekly_hours_b=20.0):
    """Create project, two persons, two memberships, initialize milestones."""
    proj = _project(session)
    alice = _person(session, "Alice")
    bob = _person(session, "Bob")
    _membership(session, proj.id, alice.id, weekly_hours=weekly_hours_a)
    _membership(session, proj.id, bob.id, weekly_hours=weekly_hours_b)
    session.commit()
    initialize_milestones(proj.id, session)
    return proj, alice, bob


# ---------------------------------------------------------------------------
# compute_drift
# ---------------------------------------------------------------------------


def test_compute_drift_no_bookings(session):
    proj, alice, bob = _setup(session)
    drifts = compute_drift(proj.id, session)
    assert len(drifts) == 2
    for d in drifts:
        assert d.actual_hours == 0.0
        assert d.planned_hours > 0.0
        assert d.drift_hours < 0.0  # under plan (nothing booked yet)


def test_compute_drift_exact_plan(session):
    proj, alice, _ = _setup(session)
    # Get Alice's planned hours for January
    ms_jan = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.project_id == proj.id,
            Milestone.month == 1,
        )
    ).first()
    budget = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms_jan.id,
            MilestonePersonBudget.person_id == alice.id,
        )
    ).first()
    planned = budget.initial_hours

    # Book exactly the planned amount
    _booking(session, proj.id, alice.id, date(2026, 1, 15), planned)
    session.commit()

    drifts = {d.person_id: d for d in compute_drift(proj.id, session)}
    # Alice's drift across all milestones: actual=planned_jan, planned=planned_jan+planned_feb
    # So she'll still be under-plan (Feb not yet booked)
    assert drifts[alice.id].actual_hours == planned


def test_compute_drift_over_plan(session):
    proj, alice, _ = _setup(session)
    _booking(session, proj.id, alice.id, date(2026, 1, 5), 999.0)
    session.commit()
    drifts = {d.person_id: d for d in compute_drift(proj.id, session)}
    assert drifts[alice.id].drift_hours > 0


def test_compute_drift_empty_project(session):
    proj = _project(session)
    session.commit()
    assert compute_drift(proj.id, session) == []


def test_compute_drift_project_not_found(session):
    # No error raised — returns empty list for unknown project
    assert compute_drift(9999, session) == []


# ---------------------------------------------------------------------------
# suggest_rebalancing
# ---------------------------------------------------------------------------


def test_suggest_rebalancing_returns_one_per_open_milestone(session):
    proj, alice, bob = _setup(session)
    suggestions = suggest_rebalancing(proj.id, session)
    assert len(suggestions) == 2  # Jan + Feb


def test_suggest_rebalancing_budgets_sum_to_milestone_total(session):
    proj, alice, bob = _setup(session)
    for suggestion in suggest_rebalancing(proj.id, session):
        total = sum(b.suggested_hours for b in suggestion.budgets)
        assert total == pytest.approx(suggestion.total_current_hours, rel=1e-3)


def test_suggest_rebalancing_proportional_to_capacity(session):
    """40h member gets 2× the allocation of a 20h member."""
    proj, alice, bob = _setup(session, weekly_hours_a=40.0, weekly_hours_b=20.0)
    suggestion = suggest_rebalancing(proj.id, session)[0]
    by_person = {b.person_id: b.suggested_hours for b in suggestion.budgets}
    ratio = by_person[alice.id] / by_person[bob.id]
    assert ratio == pytest.approx(2.0, rel=0.01)


def test_suggest_rebalancing_locked_milestone_excluded(session):
    proj, alice, bob = _setup(session)
    # Lock January
    ms_jan = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.project_id == proj.id, Milestone.month == 1
        )
    ).first()
    ms_jan.is_locked = True
    session.add(ms_jan)
    session.commit()

    suggestions = suggest_rebalancing(proj.id, session)
    months = [s.month for s in suggestions]
    assert 1 not in months
    assert 2 in months


def test_suggest_rebalancing_no_milestones(session):
    proj = _project(session)
    session.commit()
    assert suggest_rebalancing(proj.id, session) == []


def test_suggest_rebalancing_single_member(session):
    proj = _project(session)
    alice = _person(session)
    _membership(session, proj.id, alice.id, weekly_hours=40.0)
    session.commit()
    initialize_milestones(proj.id, session)

    suggestions = suggest_rebalancing(proj.id, session)
    for s in suggestions:
        assert len(s.budgets) == 1
        # Single member gets 100 % of the total
        assert s.budgets[0].suggested_hours == pytest.approx(s.total_current_hours)


# ---------------------------------------------------------------------------
# apply_rebalancing
# ---------------------------------------------------------------------------


def test_apply_rebalancing_updates_budgets(session):
    proj, alice, bob = _setup(session)
    updated = apply_rebalancing(proj.id, session)
    assert len(updated) > 0


def test_apply_rebalancing_invariant_preserved(session):
    """After apply, Milestone.current_hours == SUM(budget.current_hours)."""
    proj, alice, bob = _setup(session)
    apply_rebalancing(proj.id, session)

    milestones = session.exec(
        __import__("sqlmodel").select(Milestone).where(Milestone.project_id == proj.id)
    ).all()
    for ms in milestones:
        budgets = session.exec(
            __import__("sqlmodel").select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id
            )
        ).all()
        assert ms.current_hours == pytest.approx(sum(b.current_hours for b in budgets), rel=1e-3)


def test_apply_rebalancing_skips_locked(session):
    proj, alice, bob = _setup(session)
    ms_jan = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.project_id == proj.id, Milestone.month == 1
        )
    ).first()
    original_hours = ms_jan.current_hours
    ms_jan.is_locked = True
    session.add(ms_jan)
    session.commit()

    apply_rebalancing(proj.id, session)
    session.refresh(ms_jan)
    # Locked milestone should be unchanged
    assert ms_jan.current_hours == original_hours


def test_apply_rebalancing_idempotent(session):
    """Applying twice should produce the same result."""
    proj, alice, bob = _setup(session)
    apply_rebalancing(proj.id, session)
    updated1 = {b.id: b.current_hours for b in session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget)
    ).all()}

    apply_rebalancing(proj.id, session)
    updated2 = {b.id: b.current_hours for b in session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget)
    ).all()}

    for bid in updated1:
        assert updated1[bid] == pytest.approx(updated2[bid])
