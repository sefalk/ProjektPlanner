"""Tests for the budget-distribution rework (WP2 / §6.6).

Covers the pure `distribute_budget` function (hard invariants + priority tiers, B6)
and the integration into `initialize_milestones` (budget never exceeded, no
overbooking above available capacity).
"""
from datetime import date

import pytest
from hypothesis import HealthCheck, given, settings as h_settings
from hypothesis import strategies as st
from sqlmodel import select

from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.milestones import (
    _person_available_hours,
    distribute_budget,
    initialize_milestones,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cost(plan, rates):
    return sum(h * rates.get(pid, 0.0) for (pid, _ym), h in plan.items())


def _project(session, start=date(2026, 1, 1), end=date(2026, 3, 31),
             number="PA0001", euros=50000.0, hours=None):
    p = Project(
        project_number=number, name=f"Project {number}",
        start_date=start, end_date=end,
        total_budget_euros=euros, total_budget_hours=hours,
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


# ---------------------------------------------------------------------------
# Pure distribute_budget
# ---------------------------------------------------------------------------


def test_distribute_no_cap_returns_full_capacity():
    av = {(1, (2026, 1)): 100.0, (2, (2026, 1)): 50.0}
    plan = distribute_budget(av, {1: 90.0, 2: 100.0}, {}, None)
    assert plan == av


def test_distribute_budget_binds_proportional():
    av = {(1, (2026, 1)): 100.0, (2, (2026, 1)): 50.0}
    rates = {1: 90.0, 2: 100.0}  # Cmax = 9000 + 5000 = 14000
    plan = distribute_budget(av, rates, {}, 7000.0)
    assert _cost(plan, rates) == pytest.approx(7000.0)
    assert plan[(1, (2026, 1))] == pytest.approx(50.0)  # scaled 0.5
    assert plan[(2, (2026, 1))] == pytest.approx(25.0)


def test_distribute_budget_covers_all_no_scale():
    av = {(1, (2026, 1)): 100.0}
    plan = distribute_budget(av, {1: 90.0}, {}, 10_000_000.0)
    assert plan == av


def test_distribute_priority_high_tier_funded_first():
    av = {(1, (2026, 1)): 100.0, (2, (2026, 1)): 100.0}
    rates = {1: 90.0, 2: 90.0}
    prio = {1: 0, 2: 1}  # p1 higher priority
    # Budget = full p1 (9000) + 1800 for p2 → p2 gets 20h
    plan = distribute_budget(av, rates, prio, 9000.0 + 1800.0)
    assert plan[(1, (2026, 1))] == pytest.approx(100.0)
    assert plan[(2, (2026, 1))] == pytest.approx(20.0)
    assert _cost(plan, rates) <= 10800.0 + 1e-6


def test_distribute_priority_low_tier_starved():
    av = {(1, (2026, 1)): 100.0, (2, (2026, 1)): 100.0}
    rates = {1: 90.0, 2: 90.0}
    prio = {1: 0, 2: 1}
    plan = distribute_budget(av, rates, prio, 4500.0)  # < p1 full cost
    assert plan[(1, (2026, 1))] == pytest.approx(50.0)
    assert plan[(2, (2026, 1))] == pytest.approx(0.0)


def test_distribute_hours_cap_via_unit_rates():
    av = {(1, (2026, 1)): 100.0, (2, (2026, 1)): 50.0}
    plan = distribute_budget(av, {1: 1.0, 2: 1.0}, {}, 75.0)  # total 150 → s=0.5
    assert sum(plan.values()) == pytest.approx(75.0)


@given(
    seed=st.integers(min_value=0, max_value=10_000),
    budget=st.floats(min_value=0, max_value=50_000),
)
@h_settings(max_examples=200, deadline=None)
def test_distribute_invariants_fuzz(seed, budget):
    import random
    rnd = random.Random(seed)
    months = [(2026, mo) for mo in range(1, rnd.randint(2, 5))]
    av, rates, prio = {}, {}, {}
    for pid in range(1, rnd.randint(2, 5)):
        rates[pid] = rnd.choice([0.0, 50.0, 90.0, 120.0])
        prio[pid] = rnd.choice([0, 0, 1, 2])
        for ym in months:
            av[(pid, ym)] = rnd.choice([0.0, rnd.uniform(0, 200)])
    plan = distribute_budget(av, rates, prio, budget)
    # capacity never exceeded, never negative
    assert all(-1e-12 <= plan[k] <= av[k] + 1e-9 for k in av)
    # budget never exceeded
    assert _cost(plan, rates) <= budget + 1e-6


# ---------------------------------------------------------------------------
# Integration: initialize_milestones
# ---------------------------------------------------------------------------


def test_initialize_never_exceeds_euro_budget(session):
    """Total planned cost across all milestones must be <= project budget (B1)."""
    proj = _project(session, euros=20000.0, number="PB0001")
    a = _person(session, "Alice")
    b = _person(session, "Bob")
    _membership(session, proj.id, a.id, rate=120.0, weekly=40.0)
    _membership(session, proj.id, b.id, rate=90.0, weekly=40.0)
    session.commit()

    initialize_milestones(proj.id, session)

    budgets = session.exec(select(MilestonePersonBudget)).all()
    rates = {m.person_id: m.billing_rate_per_hour for m in session.exec(
        select(ProjectMembership)).all()}
    total_cost = sum(bd.current_hours * rates[bd.person_id] for bd in budgets)
    assert total_cost <= 20000.0 + 1e-6


def test_initialize_no_overbooking_above_capacity(session):
    """No person budget may exceed that person's available capacity (B2)."""
    proj = _project(session, euros=1_000_000.0, number="PB0002")  # budget non-binding
    p = _person(session, "Carla")
    m = _membership(session, proj.id, p.id, rate=90.0, weekly=40.0)
    session.commit()

    initialize_milestones(proj.id, session)

    for ms in session.exec(select(Milestone).where(Milestone.project_id == proj.id)).all():
        avail = _person_available_hours(p, m, proj, ms.year, ms.month, session).hours
        for bd in session.exec(select(MilestonePersonBudget).where(
                MilestonePersonBudget.milestone_id == ms.id)).all():
            assert bd.current_hours <= avail + 1e-6


def test_initialize_priority_funds_high_tier_first(session):
    """With a tight budget, the higher-priority member is funded before the lower one."""
    # One month, tight budget so not everyone can be funded fully.
    proj = _project(session, start=date(2026, 1, 1), end=date(2026, 1, 31),
                    euros=5000.0, number="PB0003")
    hi = _person(session, "High")
    lo = _person(session, "Low")
    _membership(session, proj.id, hi.id, rate=90.0, weekly=40.0, priority=0,
                from_date=date(2026, 1, 1), to_date=date(2026, 1, 31))
    _membership(session, proj.id, lo.id, rate=90.0, weekly=40.0, priority=1,
                from_date=date(2026, 1, 1), to_date=date(2026, 1, 31))
    session.commit()

    initialize_milestones(proj.id, session)

    budgets = {b.person_id: b for b in session.exec(select(MilestonePersonBudget)).all()}
    # High-priority person should receive strictly more than the starved low-priority one.
    assert budgets[hi.id].current_hours > budgets[lo.id].current_hours
    assert budgets[lo.id].current_hours == pytest.approx(0.0)


def test_initialize_milestone_total_equals_sum_of_budgets(session):
    """Invariant: Milestone.current_hours == SUM(budget.current_hours) (also initial)."""
    proj = _project(session, euros=30000.0, number="PB0004")
    a = _person(session, "Ann")
    b = _person(session, "Ben")
    _membership(session, proj.id, a.id, weekly=40.0)
    _membership(session, proj.id, b.id, weekly=20.0)
    session.commit()

    initialize_milestones(proj.id, session)

    for ms in session.exec(select(Milestone).where(Milestone.project_id == proj.id)).all():
        budgets = session.exec(select(MilestonePersonBudget).where(
            MilestonePersonBudget.milestone_id == ms.id)).all()
        assert ms.current_hours == pytest.approx(sum(x.current_hours for x in budgets))
        assert ms.initial_hours == pytest.approx(sum(x.initial_hours for x in budgets))
