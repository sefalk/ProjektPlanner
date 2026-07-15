"""Tests for the Projektposten (line-item) foundations — WP1 of doc 21.

Covers effective_rate (§21 P2): the effective hourly rate of a member is the
assigned line item's rate in position mode, otherwise the member's own rate.
"""
from datetime import date

from app.models.billing import BillingPosition
from app.models.membership import ProjectMembership
from app.services.line_items import (
    default_new_position_budget,
    position_budget_state,
    would_overshoot,
)
from app.services.milestones import effective_rate


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
