"""Unit tests for the recalculation preview + utilization recommendations.

(Drift detection and the separate rebalancing apply were removed — the single
non-destructive recompute is resync_milestones; the preview only feeds the inline hint.)
"""
from datetime import date, datetime

import pytest
from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.models.timebooking import ImportBatch, TimeBooking
from app.services.milestones import initialize_milestones, set_milestone_planning_lock
from app.services.rebalancing import compute_recommendations, preview_recalculation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, start=date(2026, 1, 1), end=date(2026, 2, 28), number="P00001", euros=50000.0):
    p = Project(project_number=number, name=f"Project {number}",
                start_date=start, end_date=end, total_budget_euros=euros)
    session.add(p)
    session.flush()
    return p


def _person(session, name="Max Mustermann"):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _membership(session, project_id, person_id, weekly_hours=40.0, rate=90.0,
                from_date=date(2026, 1, 1), to_date=date(2026, 2, 28)):
    m = ProjectMembership(project_id=project_id, person_id=person_id,
                          from_date=from_date, to_date=to_date,
                          weekly_capacity_hours=weekly_hours, billing_rate_per_hour=rate)
    session.add(m)
    session.flush()
    return m


def _booking(session, project_id, person_id, booking_date, net_hours):
    batch = session.exec(select(ImportBatch).where(ImportBatch.project_id == project_id)).first()
    if not batch:
        batch = ImportBatch(project_id=project_id, imported_at=datetime(2026, 1, 31), last_booking_date=booking_date)
        session.add(batch)
        session.flush()
    tb = TimeBooking(booking_date=booking_date, person_id=person_id, project_id=project_id,
                     import_batch_id=batch.id, sage_project_name="P00001", sage_project_level="Dev",
                     net_hours=net_hours)
    session.add(tb)
    session.flush()
    return tb


def _setup(session, weekly_hours_a=40.0, weekly_hours_b=20.0, euros=50000.0, number="P00001"):
    proj = _project(session, euros=euros, number=number)
    alice = _person(session, "Alice")
    bob = _person(session, "Bob")
    _membership(session, proj.id, alice.id, weekly_hours=weekly_hours_a)
    _membership(session, proj.id, bob.id, weekly_hours=weekly_hours_b)
    session.commit()
    initialize_milestones(proj.id, session)
    return proj, alice, bob


def _rates(session, project_id):
    return {m.person_id: m.billing_rate_per_hour for m in session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)).all()}


def _preview_cost(session, project_id):
    rates = _rates(session, project_id)
    return sum(b.suggested_hours * rates.get(b.person_id, 0.0)
               for s in preview_recalculation(project_id, session) for b in s.budgets)


# ---------------------------------------------------------------------------
# preview_recalculation
# ---------------------------------------------------------------------------


def test_preview_one_per_open_milestone(session):
    proj, _, _ = _setup(session)
    assert len(preview_recalculation(proj.id, session)) == 2  # Jan + Feb


def test_preview_matches_current_when_in_sync(session):
    """A freshly initialized project is already optimally distributed → preview == current."""
    proj, _, _ = _setup(session)
    for s in preview_recalculation(proj.id, session):
        for b in s.budgets:
            assert b.suggested_hours == pytest.approx(b.current_hours, abs=1e-6)


def test_preview_maxes_out_binding_budget(session):
    proj = _project(session, euros=10000.0, number="RBIND")
    a = _person(session, "Alice"); b = _person(session, "Bob")
    _membership(session, proj.id, a.id, weekly_hours=40.0)
    _membership(session, proj.id, b.id, weekly_hours=40.0)
    session.commit()
    initialize_milestones(proj.id, session)
    assert _preview_cost(session, proj.id) == pytest.approx(10000.0, rel=1e-3)


def test_preview_ignores_booked_open_hours(session):
    """Booked hours of OPEN months must NOT reduce the plan (they are progress, not a
    separate charge). Preview stays identical after booking."""
    proj = _project(session, euros=30000.0, number="RBOOK")
    a = _person(session, "Alice"); b = _person(session, "Bob")
    _membership(session, proj.id, a.id, weekly_hours=40.0)
    _membership(session, proj.id, b.id, weekly_hours=40.0)
    session.commit()
    initialize_milestones(proj.id, session)
    before = _preview_cost(session, proj.id)

    _booking(session, proj.id, a.id, date(2026, 1, 15), 100.0)  # 100 h booked in an open month
    session.commit()
    after = _preview_cost(session, proj.id)
    assert after == pytest.approx(before, rel=1e-6)  # unchanged — no booked subtraction


def test_preview_preserves_override(session):
    proj, alice, bob = _setup(session)
    ms_jan = session.exec(select(Milestone).where(
        Milestone.project_id == proj.id, Milestone.month == 1)).first()
    alice_jan = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms_jan.id,
        MilestonePersonBudget.person_id == alice.id)).first()
    alice_jan.current_hours = 7.0
    alice_jan.is_manual_override = True
    session.add(alice_jan)
    session.commit()
    for s in preview_recalculation(proj.id, session):
        for b in s.budgets:
            if b.budget_id == alice_jan.id:
                assert b.suggested_hours == pytest.approx(7.0)


def test_preview_skips_planning_locked(session):
    proj, _, _ = _setup(session)
    jan = session.exec(select(Milestone).where(
        Milestone.project_id == proj.id, Milestone.month == 1)).first()
    set_milestone_planning_lock(jan.id, True, session)
    months = [s.month for s in preview_recalculation(proj.id, session)]
    assert 1 not in months and 2 in months


def test_preview_no_milestones(session):
    proj = _project(session, number="RNONE")
    session.commit()
    assert preview_recalculation(proj.id, session) == []


# ---------------------------------------------------------------------------
# compute_recommendations (unchanged)
# ---------------------------------------------------------------------------


def test_recommendations_for_underbooked_member(session):
    proj = _project(session, number="RECREC")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, weekly_hours=20.0)
    session.commit()
    initialize_milestones(proj.id, session)
    recs = compute_recommendations(proj.id, session)
    assert len(recs) == 1
    assert recs[0].free_weekly_hours == pytest.approx(20.0)
    assert recs[0].recommended_additional_hours > 0


def test_recommendations_none_when_fully_committed(session):
    proj = _project(session, number="RECFULL")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, weekly_hours=40.0)
    session.commit()
    initialize_milestones(proj.id, session)
    assert compute_recommendations(proj.id, session) == []
