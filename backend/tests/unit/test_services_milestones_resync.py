"""Tests for WP4: non-destructive resync of open milestones (V5, BUG-4/5/7).

Covers resync_milestones / _align_open_milestones:
  * newly added member gets a correctly scaled budget row (BUG-4),
  * changed weekly hours are re-applied to existing auto rows (BUG-5),
  * removed / out-of-range members lose their rows (BUG-7),
  * is_manual_override rows are preserved and consume budget first,
  * hard invariants hold: Σ(current×rate) ≤ budget, current ≤ avail.
"""
from datetime import date

import pytest
from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    _person_available_hours,
    initialize_milestones,
    resync_milestones,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, start=date(2026, 1, 1), end=date(2026, 3, 31), number="RS0001", euros=1_000_000.0):
    p = Project(
        project_number=number, name=f"Project {number}",
        start_date=start, end_date=end, total_budget_euros=euros,
    )
    session.add(p)
    session.flush()
    return p


def _person(session, name):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _membership(session, project_id, person_id, rate=90.0, weekly=40.0, priority=0,
                from_date=date(2026, 1, 1), to_date=date(2026, 3, 31)):
    m = ProjectMembership(
        project_id=project_id, person_id=person_id,
        from_date=from_date, to_date=to_date,
        weekly_capacity_hours=weekly, billing_rate_per_hour=rate, priority=priority,
    )
    session.add(m)
    session.flush()
    return m


def _all_budgets(session, project_id):
    ms_ids = [m.id for m in session.exec(
        select(Milestone).where(Milestone.project_id == project_id)).all()]
    if not ms_ids:
        return []
    return session.exec(
        select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id.in_(ms_ids))  # type: ignore[attr-defined]
    ).all()


def _total_cost(session, project_id):
    rates = {m.person_id: m.billing_rate_per_hour for m in session.exec(
        select(ProjectMembership).where(ProjectMembership.project_id == project_id)).all()}
    return sum(b.current_hours * rates.get(b.person_id, 0.0) for b in _all_budgets(session, project_id))


# ---------------------------------------------------------------------------
# Newly added member (BUG-4)
# ---------------------------------------------------------------------------


def test_resync_adds_scaled_budget_for_new_member(session):
    proj = _project(session, euros=20000.0, number="RSADD")  # binding budget
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)

    # Add a second member after initialization.
    b = _person(session, "Bob")
    _membership(session, proj.id, b.id, rate=90.0)
    session.commit()

    summary = resync_milestones(proj.id, session)

    # Bob now has budget rows and the total cost never exceeds the budget (B1).
    bob_rows = [x for x in _all_budgets(session, proj.id) if x.person_id == b.id]
    assert bob_rows  # at least one added
    assert summary.added >= 1
    assert _total_cost(session, proj.id) <= 20000.0 + 1e-6


def test_resync_new_member_never_overbooks_capacity(session):
    proj = _project(session, euros=1_000_000.0, number="RSCAP")  # budget non-binding
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    b = _person(session, "Bob")
    mb = _membership(session, proj.id, b.id)
    session.commit()
    resync_milestones(proj.id, session)

    for ms in session.exec(select(Milestone).where(Milestone.project_id == proj.id)).all():
        avail = _person_available_hours(b, mb, proj, ms.year, ms.month, session).hours
        for bd in session.exec(select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id,
                MilestonePersonBudget.person_id == b.id)).all():
            assert bd.current_hours <= avail + 1e-6


# ---------------------------------------------------------------------------
# Changed weekly hours (BUG-5)
# ---------------------------------------------------------------------------


def test_resync_applies_changed_weekly_hours(session):
    proj = _project(session, euros=1_000_000.0, number="RSHRS")  # non-binding → scale 1
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id, weekly=40.0)
    session.commit()
    initialize_milestones(proj.id, session)
    before = {b.milestone_id: b.current_hours for b in _all_budgets(session, proj.id)}

    # Halve the weekly capacity and resync.
    m.weekly_capacity_hours = 20.0
    session.add(m)
    session.commit()
    resync_milestones(proj.id, session)

    after = {b.milestone_id: b.current_hours for b in _all_budgets(session, proj.id)}
    for ms_id, hrs in after.items():
        assert hrs < before[ms_id]  # capacity halved → fewer planned hours
        avail = _person_available_hours(
            a, m, proj,
            *[(x.year, x.month) for x in session.exec(
                select(Milestone).where(Milestone.id == ms_id)).all()][0],
            session).hours
        assert hrs == pytest.approx(avail, rel=1e-6)  # scale 1 → current == avail


# ---------------------------------------------------------------------------
# Removed / out-of-range member (BUG-7)
# ---------------------------------------------------------------------------


def test_resync_removes_out_of_range_member_rows(session):
    proj = _project(session, number="RSOOR")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    # Membership shrinks to February only; resync should drop Jan/Mar rows.
    m.from_date = date(2026, 2, 1)
    m.to_date = date(2026, 2, 28)
    session.add(m)
    session.commit()
    summary = resync_milestones(proj.id, session)

    ms = {(x.year, x.month): x for x in session.exec(
        select(Milestone).where(Milestone.project_id == proj.id)).all()}
    jan_rows = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms[(2026, 1)].id)).all()
    assert jan_rows == []
    assert summary.removed >= 2
    assert ms[(2026, 1)].current_hours == 0.0


# ---------------------------------------------------------------------------
# Manual override preservation
# ---------------------------------------------------------------------------


def test_resync_preserves_manual_override(session):
    proj = _project(session, euros=30000.0, number="RSOVR")
    a = _person(session, "Alice")
    b = _person(session, "Bob")
    _membership(session, proj.id, a.id, rate=90.0)
    _membership(session, proj.id, b.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)

    # Manually pin Alice's January row to a specific value.
    jan = session.exec(select(Milestone).where(
        Milestone.project_id == proj.id, Milestone.month == 1)).first()
    alice_jan = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == jan.id,
        MilestonePersonBudget.person_id == a.id)).first()
    alice_jan.current_hours = 12.5
    alice_jan.is_manual_override = True
    session.add(alice_jan)
    session.commit()

    resync_milestones(proj.id, session)

    session.refresh(alice_jan)
    assert alice_jan.current_hours == pytest.approx(12.5)  # untouched
    assert alice_jan.is_manual_override is True
    # Budget still respected including the fixed override commitment.
    assert _total_cost(session, proj.id) <= 30000.0 + 1e-6


def test_resync_idempotent_when_nothing_changed(session):
    proj = _project(session, number="RSIDEM")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)

    summary = resync_milestones(proj.id, session)
    assert summary.added == 0
    assert summary.removed == 0
    # Invariant preserved: milestone total == Σ budgets.
    for ms in session.exec(select(Milestone).where(Milestone.project_id == proj.id)).all():
        rows = session.exec(select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id)).all()
        assert ms.current_hours == pytest.approx(sum(r.current_hours for r in rows))
