"""Unit tests for holiday-region resolution (global vs. per-person override)."""

from sqlmodel import Session, SQLModel, create_engine

import pytest

from app.models.person import Person
from app.services.holiday_region import resolve_holiday_region


@pytest.fixture
def mem_session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _person(**kw) -> Person:
    return Person(name="P", sage_employee_name="P", default_weekly_hours=40.0, **kw)


def test_default_is_global(mem_session):
    assert resolve_holiday_region(mem_session) == ("DE", "BY")


def test_person_without_override_inherits_global(mem_session):
    assert resolve_holiday_region(mem_session, _person()) == ("DE", "BY")


def test_foreign_country_override_uses_empty_state(mem_session):
    # country override wins as a pair — never mixes with the global state (BY)
    p = _person(holiday_country="GR")
    assert resolve_holiday_region(mem_session, p) == ("GR", "")


def test_german_state_override(mem_session):
    p = _person(holiday_country="DE", holiday_state="BW")
    assert resolve_holiday_region(mem_session, p) == ("DE", "BW")


def test_settings_override_global(mem_session):
    from app.models.setting import Setting
    mem_session.add(Setting(key="holiday_state", value="NW"))
    mem_session.commit()
    assert resolve_holiday_region(mem_session) == ("DE", "NW")
