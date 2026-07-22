"""
Unit tests for default-settings seeding (#42).

seed_default_settings must be idempotent and multi-process safe: repeated
startups add no duplicates, and a concurrent insert by another worker (which
trips a UNIQUE constraint) must be swallowed instead of crashing startup.
"""

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

import app.db as db_module
from app.db import seed_default_settings
from app.models.setting import Setting


@pytest.fixture(name="seed_engine")
def seed_engine_fixture(monkeypatch):
    """Fresh in-memory engine wired into app.db so seeding targets it."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(db_module, "engine", engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


def _all_settings(engine) -> list[Setting]:
    with Session(engine) as session:
        return list(session.exec(select(Setting)).all())


def test_seed_populates_all_defaults(seed_engine) -> None:
    seed_default_settings()

    rows = {s.key: s.value for s in _all_settings(seed_engine)}
    assert rows == {
        "default_vacation_days": "30",
        "sick_days_per_year": "10",
        "training_days_per_year": "5",
        "holiday_country": "DE",
        "holiday_state": "BY",
        "holiday_extra": "",
    }


def test_seed_is_idempotent_across_repeated_starts(seed_engine) -> None:
    seed_default_settings()
    seed_default_settings()
    seed_default_settings()

    assert len(_all_settings(seed_engine)) == 6


def test_seed_does_not_overwrite_existing_values(seed_engine) -> None:
    with Session(seed_engine) as session:
        session.add(Setting(key="default_vacation_days", value="42"))
        session.commit()

    seed_default_settings()

    with Session(seed_engine) as session:
        assert session.get(Setting, "default_vacation_days").value == "42"


def test_seed_swallows_concurrent_insert_race(seed_engine, monkeypatch) -> None:
    """Simulate the worker race: rows already exist, but the pre-check reports
    them missing (as it would on a truly empty DB seen by two workers at once),
    forcing the INSERT path. The resulting IntegrityError must be swallowed."""
    with Session(seed_engine) as session:
        for key in ("default_vacation_days", "holiday_country"):
            session.add(Setting(key=key, value="preexisting"))
        session.commit()

    # Force every pre-check to miss, so seeding attempts the duplicate INSERTs.
    monkeypatch.setattr(Session, "get", lambda *_a, **_k: None)

    # Must not raise despite the UNIQUE constraint collisions.
    seed_default_settings()

    # Pre-existing rows survive, all six keys are present exactly once.
    rows = {s.key: s.value for s in _all_settings(seed_engine)}
    assert len(rows) == 6
    assert rows["default_vacation_days"] == "preexisting"
    assert rows["holiday_country"] == "preexisting"
    assert rows["holiday_extra"] == ""
