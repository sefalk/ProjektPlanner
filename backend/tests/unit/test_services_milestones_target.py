"""Tests for the per-milestone € target that drives hour distribution (finding A)."""
from datetime import date

import pytest
from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    MilestoneLocked,
    _person_available_hours,
    initialize_milestones,
    resync_milestones,
    set_milestone_target_budget,
)


def _project(session, number, euros=1_000_000.0, start=date(2026, 1, 1), end=date(2026, 1, 31)):
    p = Project(project_number=number, name=number, start_date=start, end_date=end,
                total_budget_euros=euros)
    session.add(p)
    session.flush()
    return p


def _person(session, name):
    p = Person(name=name, sage_employee_name=name, default_weekly_hours=40.0)
    session.add(p)
    session.flush()
    return p


def _membership(session, project_id, person_id, rate=90.0, weekly=40.0, priority=0):
    m = ProjectMembership(project_id=project_id, person_id=person_id,
                          from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
                          weekly_capacity_hours=weekly, billing_rate_per_hour=rate, priority=priority)
    session.add(m)
    session.flush()
    return m


def _milestone(session, project_id):
    return session.exec(select(Milestone).where(Milestone.project_id == project_id)).first()


def _cost(session, milestone_id, rates):
    rows = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == milestone_id)).all()
    return sum(r.current_hours * rates[r.person_id] for r in rows)


def test_target_within_capacity_hits_target(session):
    proj = _project(session, "TB01")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = _milestone(session, proj.id)

    milestone, achieved, warnings = set_milestone_target_budget(proj.id, ms.id, 9000.0, session)

    assert achieved == pytest.approx(9000.0, rel=1e-6)
    assert warnings == []
    assert milestone.target_budget_euros == pytest.approx(9000.0)
    assert _cost(session, ms.id, {a.id: 90.0}) == pytest.approx(9000.0, rel=1e-6)
    # rows are flagged so resync preserves them
    rows = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms.id)).all()
    assert all(r.is_manual_override for r in rows)


def test_target_above_capacity_is_capped_and_warns(session):
    proj = _project(session, "TB02")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = _milestone(session, proj.id)
    capacity = _person_available_hours(a, m, proj, ms.year, ms.month, session).hours
    cap_cost = capacity * 90.0

    milestone, achieved, warnings = set_milestone_target_budget(proj.id, ms.id, 999999.0, session)

    assert achieved == pytest.approx(cap_cost, rel=1e-6)  # capped at capacity
    assert any("Kapazität" in w for w in warnings)
    # no person exceeds available capacity
    for r in session.exec(select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id)).all():
        assert r.current_hours <= capacity + 1e-6


def test_target_respects_priority(session):
    proj = _project(session, "TB03")
    hi = _person(session, "High")
    lo = _person(session, "Low")
    _membership(session, proj.id, hi.id, rate=90.0, priority=0)
    _membership(session, proj.id, lo.id, rate=90.0, priority=1)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = _milestone(session, proj.id)
    hi_cap = _person_available_hours(session.get(Person, hi.id),
        session.exec(select(ProjectMembership).where(ProjectMembership.person_id == hi.id)).first(),
        proj, ms.year, ms.month, session).hours

    # Target just below the high-priority member's full cost → low gets nothing.
    set_milestone_target_budget(proj.id, ms.id, hi_cap * 90.0 * 0.5, session)

    budgets = {b.person_id: b.current_hours for b in session.exec(
        select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)).all()}
    assert budgets[hi.id] > 0
    assert budgets.get(lo.id, 0.0) == pytest.approx(0.0)


def test_target_survives_resync(session):
    proj = _project(session, "TB04")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = _milestone(session, proj.id)

    set_milestone_target_budget(proj.id, ms.id, 5400.0, session)
    resync_milestones(proj.id, session)

    assert _cost(session, ms.id, {a.id: 90.0}) == pytest.approx(5400.0, rel=1e-6)


def test_target_on_locked_raises(session):
    proj = _project(session, "TB05")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = _milestone(session, proj.id)
    ms.is_locked = True
    session.add(ms)
    session.commit()

    with pytest.raises(MilestoneLocked):
        set_milestone_target_budget(proj.id, ms.id, 1000.0, session)
