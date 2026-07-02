"""Unit tests for the milestone service."""
from datetime import date

import pytest
from hypothesis import HealthCheck, given, settings as h_settings
from hypothesis import strategies as st

from app.models.enums import AbsenceType
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person, PersonAbsence, VacationContingent
from app.models.project import Project
from app.services.milestones import (
    BudgetNotFound,
    MilestoneLocked,
    MilestoneNotFound,
    _months_in_range,
    _person_hours_in_month,
    initialize_milestones,
    update_person_budget,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project(session, start=date(2026, 1, 1), end=date(2026, 3, 31), number="P00001"):
    p = Project(
        project_number=number,
        name=f"Project {number}",
        start_date=start,
        end_date=end,
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


def _membership(
    session,
    project_id: int,
    person_id: int,
    from_date=date(2026, 1, 1),
    to_date=date(2026, 3, 31),
    weekly_hours: float = 40.0,
):
    m = ProjectMembership(
        project_id=project_id,
        person_id=person_id,
        from_date=from_date,
        to_date=to_date,
        weekly_capacity_hours=weekly_hours,
        billing_rate_per_hour=90.0,
    )
    session.add(m)
    session.flush()
    return m


# ---------------------------------------------------------------------------
# _months_in_range
# ---------------------------------------------------------------------------


def test_months_in_range_single_month():
    assert _months_in_range(date(2026, 3, 1), date(2026, 3, 31)) == [(2026, 3)]


def test_months_in_range_quarter():
    result = _months_in_range(date(2026, 1, 1), date(2026, 3, 31))
    assert result == [(2026, 1), (2026, 2), (2026, 3)]


def test_months_in_range_cross_year():
    result = _months_in_range(date(2025, 11, 1), date(2026, 2, 28))
    assert result == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


def test_months_in_range_mid_month_boundaries():
    # Start mid-Jan, end mid-Mar — still includes Jan, Feb, Mar
    result = _months_in_range(date(2026, 1, 15), date(2026, 3, 10))
    assert (2026, 1) in result
    assert (2026, 3) in result


# ---------------------------------------------------------------------------
# _person_hours_in_month
# ---------------------------------------------------------------------------


def test_person_hours_full_month_40h():
    """40h/week member for full Jan 2026 (22 working days)."""
    m = ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=90.0,
    )
    hours = _person_hours_in_month(m, 2026, 1)
    # Jan 2026: Thu Jan 1, Fri Jan 2, Mon–Fri Jan 5–30 → 22 weekdays → 22 * 8 = 176h
    assert hours == pytest.approx(22 * 8.0)


def test_person_hours_partial_month():
    """Member joins mid-month (Jan 16–31 = 11 working days: Fri + 2 full weeks)."""
    m = ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 16), to_date=date(2026, 1, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=90.0,
    )
    hours = _person_hours_in_month(m, 2026, 1)
    # Jan 16 is Fri (1) + Jan 19–23 (5) + Jan 26–30 (5) = 11 weekdays
    assert hours == pytest.approx(11 * 8.0)


def test_person_hours_no_overlap():
    """Membership ends before the month starts → 0 hours."""
    m = ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=90.0,
    )
    assert _person_hours_in_month(m, 2026, 2) == 0.0


def test_person_hours_part_time_20h():
    """20h/week member for full Jan 2026 (22 working days)."""
    m = ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 1, 31),
        weekly_capacity_hours=20.0, billing_rate_per_hour=90.0,
    )
    hours = _person_hours_in_month(m, 2026, 1)
    # 22 weekdays × (20h / 5 days) = 22 × 4 = 88h
    assert hours == pytest.approx(22 * 4.0)


# ---------------------------------------------------------------------------
# initialize_milestones
# ---------------------------------------------------------------------------


def test_initialize_creates_one_milestone_per_month(session):
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31))
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()
    created = initialize_milestones(proj.id, session)
    assert len(created) == 3
    months = {(m.year, m.month) for m in created}
    assert months == {(2026, 1), (2026, 2), (2026, 3)}


def test_initialize_creates_budgets_for_members(session):
    proj = _project(session)
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()

    initialize_milestones(proj.id, session)

    budgets = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget)
    ).all()
    assert len(budgets) == 3  # one per month


def test_initialize_invariant_hours(session):
    """Milestone.current_hours == SUM(MilestonePersonBudget.current_hours)."""
    proj = _project(session)
    p1 = _person(session, "Alice")
    p2 = _person(session, "Bob")
    _membership(session, proj.id, p1.id, weekly_hours=40.0)
    _membership(session, proj.id, p2.id, weekly_hours=20.0)
    session.commit()

    initialize_milestones(proj.id, session)

    milestones = session.exec(__import__("sqlmodel").select(Milestone)).all()
    for ms in milestones:
        budgets = session.exec(
            __import__("sqlmodel").select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id
            )
        ).all()
        assert ms.current_hours == pytest.approx(sum(b.current_hours for b in budgets))


def test_initialize_idempotent(session):
    proj = _project(session)
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()
    first = initialize_milestones(proj.id, session)
    second = initialize_milestones(proj.id, session)
    assert len(first) == 3
    assert second == []  # nothing new


def test_initialize_no_members_raises(session):
    """§8.1: milestones require personnel — init without an active member is refused."""
    from app.services.milestones import NoActiveMembership

    proj = _project(session)
    session.commit()
    with pytest.raises(NoActiveMembership):
        initialize_milestones(proj.id, session)
    # No milestones were created (guard runs before any mutation).
    from sqlmodel import select as sq_select
    assert session.exec(sq_select(Milestone).where(Milestone.project_id == proj.id)).all() == []


def test_initialize_membership_outside_range_raises(session):
    """A membership that does not overlap the project range is not 'active' (§8.1)."""
    from app.services.milestones import NoActiveMembership

    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31))
    person = _person(session)
    _membership(session, proj.id, person.id,
                from_date=date(2027, 1, 1), to_date=date(2027, 3, 31))
    session.commit()
    with pytest.raises(NoActiveMembership):
        initialize_milestones(proj.id, session)


def test_initialize_partial_membership(session):
    """Member is active only in February; January and March budgets should be 0."""
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31))
    person = _person(session)
    _membership(session, proj.id, person.id,
                from_date=date(2026, 2, 1), to_date=date(2026, 2, 28))
    session.commit()

    initialize_milestones(proj.id, session)

    milestones = {
        (m.year, m.month): m
        for m in session.exec(__import__("sqlmodel").select(Milestone)).all()
    }
    assert milestones[(2026, 1)].current_hours == 0.0
    assert milestones[(2026, 2)].current_hours > 0.0
    assert milestones[(2026, 3)].current_hours == 0.0


def test_initialize_project_not_found(session):
    with pytest.raises(MilestoneNotFound):
        initialize_milestones(9999, session)


def test_initialize_budget_scaling(session):
    """When capacity > total_budget_hours and no euro budget, hours are scaled down to match."""
    # Use total_budget_euros=0 to exercise the legacy hours-budget path.
    # 40h/week × 3 months ≈ capacity; budget_hours = 400 → scale < 1
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31), number="PBS01")
    proj.total_budget_hours = 400.0
    proj.total_budget_euros = 0.0  # bypass euro path
    session.add(proj)
    person = _person(session, "Budget Person")
    _membership(session, proj.id, person.id, weekly_hours=40.0)
    session.commit()

    created = initialize_milestones(proj.id, session)

    total_current = sum(m.current_hours for m in created)
    total_initial = sum(m.initial_hours for m in created)

    assert total_current == pytest.approx(400.0, rel=1e-4)
    # initial_hours == current_hours at init (both carry the scaled plan value)
    assert total_initial == pytest.approx(total_current, rel=1e-4)


def test_initialize_no_scaling_when_capacity_within_budget(session):
    """When capacity <= budget, initial_hours == current_hours (no scaling)."""
    proj = _project(session, date(2026, 1, 1), date(2026, 1, 31), number="PBS02")
    proj.total_budget_hours = 5000.0  # far above capacity
    session.add(proj)
    person = _person(session, "No-Scale Person")
    _membership(session, proj.id, person.id, weekly_hours=40.0)
    session.commit()

    created = initialize_milestones(proj.id, session)
    assert len(created) == 1
    ms = created[0]
    assert ms.initial_hours == pytest.approx(ms.current_hours)


def test_initialize_budget_scaling_invariant(session):
    """After budget scaling, Milestone.current_hours == SUM(MilestonePersonBudget.current_hours)."""
    from sqlmodel import select as sq_select
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31), number="PBS03")
    proj.total_budget_hours = 300.0
    session.add(proj)
    p1 = _person(session, "Scale Alice")
    p2 = _person(session, "Scale Bob")
    _membership(session, proj.id, p1.id, weekly_hours=40.0)
    _membership(session, proj.id, p2.id, weekly_hours=20.0)
    session.commit()

    initialize_milestones(proj.id, session)

    milestones = session.exec(sq_select(Milestone).where(Milestone.project_id == proj.id)).all()
    for ms in milestones:
        budgets = session.exec(
            sq_select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all()
        assert ms.current_hours == pytest.approx(sum(b.current_hours for b in budgets), rel=1e-5)


def test_vacation_estimate_per_month_not_globally_disabled(session):
    """A vacation entry in month A must not suppress the estimate in month B."""
    from sqlmodel import select as sq_select
    proj = _project(session, date(2026, 1, 1), date(2026, 3, 31), number="PVE01")
    proj.total_budget_hours = 10000.0  # well above capacity — no scaling
    proj.total_budget_euros = 0.0  # bypass euro path so scale = 1.0
    session.add(proj)
    person = _person(session, "Vacation Test Person")
    _membership(session, proj.id, person.id, weekly_hours=40.0)

    # Give person a vacation contingent
    vc = VacationContingent(person_id=person.id, year=2026, total_days=30)
    session.add(vc)

    # Specific vacation only in January
    absence = PersonAbsence(
        person_id=person.id,
        absence_type=AbsenceType.vacation,
        status="confirmed",
        start_date=date(2026, 1, 12),
        end_date=date(2026, 1, 16),
        note="",
    )
    session.add(absence)
    session.commit()

    initialize_milestones(proj.id, session)

    milestones = {
        (m.year, m.month): m
        for m in session.exec(sq_select(Milestone).where(Milestone.project_id == proj.id)).all()
    }

    # Jan: has specific vacation → abs_days deducted, no estimate → hours slightly lower
    # Feb + Mar: no specific vacation → estimate applied → hours lower than gross capacity
    # Without the fix, Feb and Mar would have no estimate (has_vacation wrongly True),
    # making them equal to gross capacity.
    feb_ms = milestones[(2026, 2)]
    mar_ms = milestones[(2026, 3)]

    # Raw capacity Feb (no holidays in tests): 20 × 8 = 160h
    # With vacation estimate of 30/12 ≈ 2.5 days → deduction ≈ 20h
    # So hours should be noticeably less than 160
    raw_feb_capacity = 20 * (40.0 / 5.0)  # 20 working days × 8h
    assert feb_ms.initial_hours < raw_feb_capacity  # estimate was applied
    assert mar_ms.initial_hours < 22 * (40.0 / 5.0)  # same for March


# ---------------------------------------------------------------------------
# update_person_budget — invariant enforcement
# ---------------------------------------------------------------------------


def test_update_budget_syncs_milestone_total(session):
    proj = _project(session)
    person = _person(session)
    _membership(session, proj.id, person.id, weekly_hours=40.0)
    session.commit()
    initialize_milestones(proj.id, session)

    ms = session.exec(
        __import__("sqlmodel").select(Milestone).where(
            Milestone.month == 1
        )
    ).first()
    budget = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id
        )
    ).first()

    original_total = ms.current_hours
    new_hours = budget.current_hours + 8.0  # add one day

    updated_budget, updated_ms = update_person_budget(ms.id, budget.id, new_hours, session)

    assert updated_budget.current_hours == pytest.approx(new_hours)
    assert updated_ms.current_hours == pytest.approx(original_total + 8.0)


def test_update_budget_locked_milestone(session):
    proj = _project(session)
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()
    initialize_milestones(proj.id, session)

    ms = session.exec(__import__("sqlmodel").select(Milestone)).first()
    ms.is_locked = True
    session.add(ms)
    session.commit()

    budget = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id
        )
    ).first()

    with pytest.raises(MilestoneLocked):
        update_person_budget(ms.id, budget.id, 100.0, session)


def test_update_budget_not_found(session):
    proj = _project(session)
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()
    initialize_milestones(proj.id, session)
    ms = session.exec(__import__("sqlmodel").select(Milestone)).first()

    with pytest.raises(BudgetNotFound):
        update_person_budget(ms.id, 9999, 10.0, session)


def test_update_budget_milestone_not_found(session):
    with pytest.raises(MilestoneNotFound):
        update_person_budget(9999, 1, 10.0, session)


def test_update_budget_wrong_milestone(session):
    """Budget from a different milestone should raise BudgetNotFound."""
    proj = _project(session, date(2026, 1, 1), date(2026, 2, 28))
    person = _person(session)
    _membership(session, proj.id, person.id)
    session.commit()
    initialize_milestones(proj.id, session)

    milestones = session.exec(__import__("sqlmodel").select(Milestone)).all()
    ms1 = next(m for m in milestones if m.month == 1)
    ms2 = next(m for m in milestones if m.month == 2)

    budget_of_ms1 = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms1.id
        )
    ).first()

    with pytest.raises(BudgetNotFound):
        update_person_budget(ms2.id, budget_of_ms1.id, 10.0, session)


# ---------------------------------------------------------------------------
# Hypothesis: invariant holds across random hour updates
# ---------------------------------------------------------------------------


@given(delta=st.floats(min_value=0, max_value=200))
@h_settings(max_examples=20, suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=2000)
def test_invariant_after_update(delta, session):
    """After any valid budget update, SUM(budgets) == milestone.current_hours."""
    from sqlmodel import func, select as sq_select
    count = session.exec(sq_select(func.count(Project.id))).one()
    proj = _project(session, number=f"PH{count:05d}")
    person = _person(session, name=f"Hypothesis Person {count}")
    _membership(session, proj.id, person.id)
    session.commit()
    initialize_milestones(proj.id, session)

    ms = session.exec(
        __import__("sqlmodel").select(Milestone).where(Milestone.project_id == proj.id)
    ).first()
    budget = session.exec(
        __import__("sqlmodel").select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id
        )
    ).first()

    if budget:
        _, updated_ms = update_person_budget(ms.id, budget.id, delta, session)
        all_budgets = session.exec(
            __import__("sqlmodel").select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id
            )
        ).all()
        assert updated_ms.current_hours == pytest.approx(sum(b.current_hours for b in all_budgets))
