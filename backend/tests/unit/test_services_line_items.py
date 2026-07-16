"""Tests for the Projektposten (line-item) feature — WP1–WP3 of doc 21.

Covers effective_rate (§21 P2), the budget-consistency invariant (§P3), and the
per-position distribution (§P4: each line item is a hard sub-cap, no cross-position
borrowing).
"""
from datetime import date

import pytest
from sqlmodel import select

from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.person import Person
from app.models.project import Project
from app.services.line_items import (
    default_new_position_budget,
    position_budget_state,
    would_overshoot,
)
from app.services.milestones import effective_rate, initialize_milestones


def _membership(rate=100.0, position_id=None):
    return ProjectMembership(
        project_id=1, person_id=1,
        from_date=date(2026, 1, 1), to_date=date(2026, 12, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=rate,
        billing_position_id=position_id,
    )


def _position(pid, rate):
    return BillingPosition(id=pid, project_id=1, position_number=f"P{pid}",
                           budget_euros=10000.0, billing_rate_per_hour=rate)


def test_simple_mode_uses_member_rate():
    m = _membership(rate=95.0, position_id=None)
    assert effective_rate(m, {}) == 95.0


def test_position_mode_uses_position_rate():
    m = _membership(rate=95.0, position_id=7)
    positions = {7: _position(7, 120.0)}
    assert effective_rate(m, positions) == 120.0


def test_position_missing_falls_back_to_member_rate():
    # Assigned to a position that isn't in the lookup (e.g. deleted) → member rate.
    m = _membership(rate=95.0, position_id=99)
    positions = {7: _position(7, 120.0)}
    assert effective_rate(m, positions) == 95.0


def test_position_zero_rate_is_honoured():
    # A position with rate 0 (simple invoicing position) overrides, giving 0 — not fallback.
    m = _membership(rate=95.0, position_id=3)
    positions = {3: _position(3, 0.0)}
    assert effective_rate(m, positions) == 0.0


# ---------------------------------------------------------------------------
# Budget-consistency invariant (§P3)
# ---------------------------------------------------------------------------


def test_budget_state_open_remainder():
    s = position_budget_state(100_000.0, [40_000.0, 30_000.0])
    assert s.allocated_euros == 70_000.0
    assert s.open_euros == 30_000.0
    assert not s.is_over
    assert not s.is_complete


def test_budget_state_complete():
    s = position_budget_state(100_000.0, [60_000.0, 40_000.0])
    assert s.open_euros == 0.0
    assert s.is_complete
    assert not s.is_over


def test_budget_state_overshoot():
    s = position_budget_state(100_000.0, [60_000.0, 50_000.0])
    assert s.is_over
    assert not s.is_complete
    assert s.open_euros < 0


def test_default_new_position_is_open_difference():
    assert default_new_position_budget(100_000.0, [70_000.0]) == 30_000.0


def test_default_new_position_never_negative():
    # Already over-allocated (shouldn't happen, but the default must not go negative).
    assert default_new_position_budget(100_000.0, [120_000.0]) == 0.0


def test_would_overshoot_blocks_over_total():
    assert would_overshoot(100_000.0, [70_000.0], 40_000.0) is True
    assert would_overshoot(100_000.0, [70_000.0], 30_000.0) is False  # exact fit ok


# ---------------------------------------------------------------------------
# Per-position distribution (§P4) — integration through initialize_milestones
# ---------------------------------------------------------------------------


def _setup_two_positions(session):
    """Project with two priced line items and one member each. Big enough weekly hours
    that both positions bind on their euro budget, not on capacity."""
    project = Project(
        project_number="PP001", name="Posten Projekt",
        start_date=date(2026, 1, 1), end_date=date(2026, 3, 31),
        total_budget_euros=30_000.0,
    )
    session.add(project)
    session.flush()

    pos_a = BillingPosition(project_id=project.id, position_number="A",
                            budget_euros=20_000.0, billing_rate_per_hour=100.0)
    pos_b = BillingPosition(project_id=project.id, position_number="B",
                            budget_euros=10_000.0, billing_rate_per_hour=50.0)
    session.add(pos_a)
    session.add(pos_b)
    session.flush()

    pa = Person(name="Anna", sage_employee_name="Anna", default_weekly_hours=40.0)
    pb = Person(name="Bert", sage_employee_name="Bert", default_weekly_hours=40.0)
    session.add(pa)
    session.add(pb)
    session.flush()

    session.add(ProjectMembership(
        project_id=project.id, person_id=pa.id, from_date=date(2026, 1, 1), to_date=date(2026, 3, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=0.0, billing_position_id=pos_a.id))
    session.add(ProjectMembership(
        project_id=project.id, person_id=pb.id, from_date=date(2026, 1, 1), to_date=date(2026, 3, 31),
        weekly_capacity_hours=40.0, billing_rate_per_hour=0.0, billing_position_id=pos_b.id))
    session.flush()
    return project, pos_a, pos_b, pa, pb


def _position_cost(session, project_id, pos, person_id):
    """Σ(current_hours) × pos.rate for one person across all milestones of the project."""
    total_hours = 0.0
    for ms in session.exec(select(Milestone).where(Milestone.project_id == project_id)).all():
        for b in session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all():
            if b.person_id == person_id:
                total_hours += b.current_hours
    return total_hours * pos.billing_rate_per_hour


def test_position_mode_each_bucket_respects_its_own_subcap(session):
    project, pos_a, pos_b, pa, pb = _setup_two_positions(session)
    initialize_milestones(project.id, session)

    cost_a = _position_cost(session, project.id, pos_a, pa.id)
    cost_b = _position_cost(session, project.id, pos_b, pb.id)

    # §P4: each position's spend is capped by ITS OWN budget, independently.
    assert cost_a <= pos_a.budget_euros + 1e-6
    assert cost_b <= pos_b.budget_euros + 1e-6
    # Capacity is ample, so each bucket should fully consume its budget (binds on €, B1).
    assert cost_a == pytest.approx(pos_a.budget_euros)
    assert cost_b == pytest.approx(pos_b.budget_euros)


def test_position_mode_buckets_are_independent(session):
    # Position A has far more capacity-value than its budget; position B has slack.
    # A must NOT borrow B's unused budget (no cross-position shifting, §P4).
    project, pos_a, pos_b, pa, pb = _setup_two_positions(session)
    # Shrink B's budget so B is nearly empty; A stays budget-bound.
    pos_b.budget_euros = 500.0
    session.add(pos_b)
    session.flush()

    initialize_milestones(project.id, session)

    cost_a = _position_cost(session, project.id, pos_a, pa.id)
    cost_b = _position_cost(session, project.id, pos_b, pb.id)
    # A capped at its own 20k even though the project total (30k) and B's slack exist.
    assert cost_a <= pos_a.budget_euros + 1e-6
    assert cost_b <= 500.0 + 1e-6


def test_simple_mode_unaffected_when_no_member_assigned(session):
    # No billing_position_id anywhere → simple mode, one global budget (regression guard).
    project = Project(
        project_number="SM01", name="Simple", start_date=date(2026, 1, 1),
        end_date=date(2026, 2, 28), total_budget_euros=10_000.0,
    )
    session.add(project)
    session.flush()
    person = Person(name="Cara", sage_employee_name="Cara", default_weekly_hours=40.0)
    session.add(person)
    session.flush()
    session.add(ProjectMembership(
        project_id=project.id, person_id=person.id, from_date=date(2026, 1, 1),
        to_date=date(2026, 2, 28), weekly_capacity_hours=40.0, billing_rate_per_hour=100.0))
    session.flush()

    initialize_milestones(project.id, session)
    total_cost = 0.0
    for ms in session.exec(select(Milestone).where(Milestone.project_id == project.id)).all():
        for b in session.exec(
            select(MilestonePersonBudget).where(MilestonePersonBudget.milestone_id == ms.id)
        ).all():
            total_cost += b.current_hours * 100.0
    assert total_cost <= 10_000.0 + 1e-6
