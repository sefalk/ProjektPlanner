"""Tests for lockable editable quantities + estimated-absence override (findings 1/2)."""
from datetime import date

import pytest
from sqlmodel import select

from app.models.enums import AbsenceType
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.models.setting import Setting
from app.services.milestones import (
    MilestoneLocked,
    _person_available_hours,
    clear_milestone_target_budget,
    initialize_milestones,
    manual_budget_update,
    resync_milestones,
    set_budget_hours_lock,
    set_estimated_absence,
    set_milestone_planning_lock,
    set_milestone_target_budget,
)


def _project(session, number, euros=1_000_000.0, start=date(2026, 1, 1), end=date(2026, 1, 31)):
    p = Project(project_number=number, name=number, start_date=start, end_date=end, total_budget_euros=euros)
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
                          from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
                          weekly_capacity_hours=weekly, billing_rate_per_hour=rate)
    session.add(m)
    session.flush()
    return m


def _ms_and_budget(session, project_id, person_id):
    ms = session.exec(select(Milestone).where(Milestone.project_id == project_id)).first()
    b = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms.id,
        MilestonePersonBudget.person_id == person_id)).first()
    return ms, b


# ---------------------------------------------------------------------------
# Estimated-absence override
# ---------------------------------------------------------------------------


def test_estimated_absence_override_changes_availability(session):
    proj = _project(session, "LK01")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, _ = _ms_and_budget(session, proj.id, a.id)

    before = _person_available_hours(a, m, proj, ms.year, ms.month, session)
    set_estimated_absence(ms.id, a.id, 10.0, session)
    after = _person_available_hours(a, m, proj, ms.year, ms.month, session)

    assert after.estimated_absence_days == pytest.approx(10.0)
    assert after.hours < before.hours  # more absence → less available

    set_estimated_absence(ms.id, a.id, None, session)  # clear → back to auto
    reset = _person_available_hours(a, m, proj, ms.year, ms.month, session)
    assert reset.hours == pytest.approx(before.hours)


def test_estimated_absence_negative_raises(session):
    proj = _project(session, "LK02")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, _ = _ms_and_budget(session, proj.id, a.id)
    with pytest.raises(ValueError):
        set_estimated_absence(ms.id, a.id, -1.0, session)


# ---------------------------------------------------------------------------
# Sick/training estimate subtracts concrete days (clamped >= 0)
# ---------------------------------------------------------------------------


def test_sick_estimate_even_annual_minus_concrete(session):
    session.add(Setting(key="sick_days_per_year", value="12"))     # annual richtwert
    session.add(Setting(key="training_days_per_year", value="0"))   # isolate sick
    proj = _project(session, "LK03")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    session.commit()

    # No concrete sick → January's even share of the annual value: 12 × 31/365 ≈ 1.02.
    base = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    assert base == pytest.approx(12 * 31 / 365, abs=0.02)

    # A 3-day concrete sick absence → remaining 9, effective period days 31−3=28: 9 × 28/365.
    session.add(PersonAbsence(person_id=a.id, absence_type=AbsenceType.sick, status="confirmed",
                              start_date=date(2026, 1, 12), end_date=date(2026, 1, 14), note=""))
    session.commit()
    with_sick = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    assert with_sick == pytest.approx(9 * 28 / 365, abs=0.03)
    assert with_sick < base


def test_sick_estimate_clamps_when_concrete_exceeds_annual(session):
    session.add(Setting(key="sick_days_per_year", value="2"))
    session.add(Setting(key="training_days_per_year", value="0"))
    proj = _project(session, "LK03B")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    # 5 concrete sick days > annual richtwert 2 → remaining clamps to 0, estimate 0.
    session.add(PersonAbsence(person_id=a.id, absence_type=AbsenceType.sick, status="confirmed",
                              start_date=date(2026, 1, 10), end_date=date(2026, 1, 14), note=""))
    session.commit()
    est = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    assert est == pytest.approx(0.0, abs=1e-9)


def test_project_pauschal_override_and_disable(session):
    session.add(Setting(key="sick_days_per_year", value="12"))
    session.add(Setting(key="training_days_per_year", value="0"))
    proj = _project(session, "LK03C")
    a = _person(session, "Alice")
    m = _membership(session, proj.id, a.id)
    session.commit()

    globalv = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    proj.sick_days_per_year_override = 0.0  # disable
    session.add(proj); session.commit()
    disabled = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    assert disabled == pytest.approx(0.0, abs=1e-9)
    assert globalv > disabled

    proj.sick_days_per_year_override = 24.0  # override higher than global
    session.add(proj); session.commit()
    higher = _person_available_hours(a, m, proj, 2026, 1, session).estimated_absence_days
    assert higher == pytest.approx(globalv * 2, rel=0.02)


# ---------------------------------------------------------------------------
# Hours lock / unlock
# ---------------------------------------------------------------------------


def test_hours_lock_preserved_unlock_recomputed(session):
    proj = _project(session, "LK04")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _ms_and_budget(session, proj.id, a.id)

    # Manually set + lock at 3 h.
    manual_budget_update(ms.id, b.id, 3.0, session)
    resync_milestones(proj.id, session)
    session.refresh(b)
    assert b.current_hours == pytest.approx(3.0)  # locked → preserved
    assert b.is_manual_override is True

    # Unlock → value stays until recompute, then resync recomputes it.
    set_budget_hours_lock(ms.id, a.id, False, session)
    session.refresh(b)
    assert b.is_manual_override is False
    assert b.current_hours == pytest.approx(3.0)  # unchanged until an action runs
    resync_milestones(proj.id, session)
    session.refresh(b)
    assert b.current_hours != pytest.approx(3.0)  # recomputed to full availability


# ---------------------------------------------------------------------------
# Clear € target (unlock)
# ---------------------------------------------------------------------------


def test_clear_target_unlocks_rows_and_keeps_hours(session):
    proj = _project(session, "LK05")
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, _ = _ms_and_budget(session, proj.id, a.id)

    set_milestone_target_budget(proj.id, ms.id, 4500.0, session)
    session.refresh(ms)
    assert ms.target_budget_euros == pytest.approx(4500.0)
    hours_before = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms.id,
        MilestonePersonBudget.person_id == a.id)).first().current_hours

    clear_milestone_target_budget(proj.id, ms.id, session)
    session.refresh(ms)
    assert ms.target_budget_euros is None
    rows = session.exec(select(MilestonePersonBudget).where(
        MilestonePersonBudget.milestone_id == ms.id)).all()
    assert all(not r.is_manual_override for r in rows)  # unlocked
    assert rows[0].current_hours == pytest.approx(hours_before)  # value kept until recompute


def test_planning_lock_freezes_month_from_recompute(session):
    proj = _project(session, "LK06", euros=20000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id, rate=90.0)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, b = _ms_and_budget(session, proj.id, a.id)

    # Manually pin the month's row to an off value, then planning-lock the month.
    b.current_hours = 3.0
    session.add(b); session.commit()
    set_milestone_planning_lock(ms.id, True, session)
    session.refresh(ms)
    assert ms.is_planning_locked is True

    resync_milestones(proj.id, session)  # must skip the locked month entirely
    session.refresh(b)
    assert b.current_hours == pytest.approx(3.0)  # untouched despite not being an override

    # Unlock → recompute may change it again.
    set_milestone_planning_lock(ms.id, False, session)
    resync_milestones(proj.id, session)
    session.refresh(b)
    assert b.current_hours != pytest.approx(3.0)


def test_planning_lock_rejected_on_closed(session):
    proj = _project(session, "LK07", euros=20000.0)
    a = _person(session, "Alice")
    _membership(session, proj.id, a.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms, _ = _ms_and_budget(session, proj.id, a.id)
    ms.is_locked = True
    session.add(ms); session.commit()
    with pytest.raises(MilestoneLocked):
        set_milestone_planning_lock(ms.id, True, session)
