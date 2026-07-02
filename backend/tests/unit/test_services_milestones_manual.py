"""Tests for WP5: manual budget adjustment with confirmation (V6, §8.2, BUG-6)."""
from datetime import date

import pytest
from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    BudgetConfirmationRequired,
    MilestoneLocked,
    _person_available_hours,
    initialize_milestones,
    manual_budget_update,
)


def _project(session, number, euros, start=date(2026, 1, 1), end=date(2026, 3, 31)):
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


def _membership(session, project_id, person_id, rate=90.0, weekly=40.0):
    m = ProjectMembership(project_id=project_id, person_id=person_id,
                          from_date=date(2026, 1, 1), to_date=date(2026, 3, 31),
                          weekly_capacity_hours=weekly, billing_rate_per_hour=rate)
    session.add(m)
    session.flush()
    return m


def _first_budget(session, project_id):
    ms = session.exec(select(Milestone).where(
        Milestone.project_id == project_id).order_by(Milestone.month)).first()
    b = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms.id)).first()
    return ms, b


def test_manual_update_within_budget_sets_override(session):
    proj = _project(session, "MU01", euros=1_000_000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)

    budget, milestone, warnings = manual_budget_update(ms.id, b.id, 10.0, session)

    assert budget.current_hours == pytest.approx(10.0)
    assert budget.is_manual_override is True
    assert warnings == []
    assert milestone.current_hours == pytest.approx(10.0)


def test_manual_update_over_budget_without_confirm_raises_and_does_not_save(session):
    proj = _project(session, "MU02", euros=20000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)
    old = b.current_hours

    with pytest.raises(BudgetConfirmationRequired) as exc:
        manual_budget_update(ms.id, b.id, 500.0, session)  # 500×90 = 45000 » 20000
    assert any("Budget" in w for w in exc.value.warnings)

    session.refresh(b)
    assert b.current_hours == pytest.approx(old)  # not saved
    assert b.is_manual_override is False


def test_manual_update_over_budget_with_confirm_saves(session):
    proj = _project(session, "MU03", euros=20000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)

    budget, _, warnings = manual_budget_update(ms.id, b.id, 500.0, session, confirm=True)

    assert budget.current_hours == pytest.approx(500.0)
    assert budget.is_manual_override is True
    assert any("Budget" in w for w in warnings)


def test_manual_update_over_capacity_only_warns(session):
    proj = _project(session, "MU04", euros=1_000_000.0)  # budget non-binding
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)
    avail = _person_available_hours(a, m, proj, ms.year, ms.month, session).hours

    budget, _, warnings = manual_budget_update(ms.id, b.id, avail + 50.0, session)

    assert budget.current_hours == pytest.approx(avail + 50.0)  # saved (soft)
    assert any("Kapazität" in w for w in warnings)


def test_manual_update_negative_raises(session):
    proj = _project(session, "MU05", euros=1_000_000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)

    with pytest.raises(ValueError):
        manual_budget_update(ms.id, b.id, -1.0, session)


def test_manual_update_locked_raises(session):
    proj = _project(session, "MU06", euros=1_000_000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _first_budget(session, proj.id)
    ms.is_locked = True
    session.add(ms)
    session.commit()

    with pytest.raises(MilestoneLocked):
        manual_budget_update(ms.id, b.id, 10.0, session)
