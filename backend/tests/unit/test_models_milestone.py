"""Tests for Milestone and MilestonePersonBudget models."""

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from app.models.milestone import Milestone, MilestonePersonBudget
from app.models.enums import MilestoneStatus


def test_milestone_valid() -> None:
    m = Milestone(project_id=1, year=2026, month=4, initial_hours=80.0, current_hours=80.0)
    assert m.status == MilestoneStatus.open
    assert not m.is_locked


def test_milestone_month_too_low() -> None:
    with pytest.raises(ValidationError):
        Milestone(project_id=1, year=2026, month=0, initial_hours=80.0, current_hours=80.0)


def test_milestone_month_too_high() -> None:
    with pytest.raises(ValidationError):
        Milestone(project_id=1, year=2026, month=13, initial_hours=80.0, current_hours=80.0)


def test_milestone_negative_initial_hours() -> None:
    with pytest.raises(ValidationError):
        Milestone(project_id=1, year=2026, month=4, initial_hours=-1.0, current_hours=0.0)


def test_milestone_negative_current_hours() -> None:
    with pytest.raises(ValidationError):
        Milestone(project_id=1, year=2026, month=4, initial_hours=80.0, current_hours=-1.0)


def test_milestone_person_budget_valid() -> None:
    mpb = MilestonePersonBudget(milestone_id=1, person_id=1, initial_hours=40.0, current_hours=40.0)
    assert mpb.initial_hours == 40.0


def test_milestone_person_budget_negative_hours() -> None:
    with pytest.raises(ValidationError):
        MilestonePersonBudget(milestone_id=1, person_id=1, initial_hours=-1.0, current_hours=0.0)


@given(month=st.integers(min_value=1, max_value=12))
def test_milestone_all_valid_months_accepted(month: int) -> None:
    m = Milestone(project_id=1, year=2026, month=month, initial_hours=0.0, current_hours=0.0)
    assert m.month == month


@given(month=st.integers().filter(lambda x: not (1 <= x <= 12)))
def test_milestone_invalid_months_rejected(month: int) -> None:
    with pytest.raises(ValidationError):
        Milestone(project_id=1, year=2026, month=month, initial_hours=0.0, current_hours=0.0)


@given(hours=st.floats(min_value=0.0, max_value=10_000.0, allow_nan=False))
def test_milestone_person_budget_non_negative_hours_always_valid(hours: float) -> None:
    mpb = MilestonePersonBudget(milestone_id=1, person_id=1, initial_hours=hours, current_hours=hours)
    assert mpb.current_hours >= 0
