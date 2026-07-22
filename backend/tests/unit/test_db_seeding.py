"""Per-owner default-settings seeding (#42, doc 25 WP3 step 3b).

Settings are per-owner now, so ``ensure_owner_settings`` seeds a given owner's
defaults on demand (from an owner-bound session): it must be idempotent, must
not overwrite existing values, must isolate owners, and must swallow the
concurrent-insert race (two requests seeding a brand-new owner at once).
"""

from sqlmodel import select

from app.db import DEFAULT_SETTINGS, ensure_owner_settings
from app.models.setting import Setting
from app.tenancy import bind_owner, bypass_owner_filter


def _all_rows(session):
    with bypass_owner_filter(session):
        return session.exec(select(Setting)).all()


def test_ensure_seeds_all_defaults_for_owner(session):
    bind_owner(session, user_id=1)
    ensure_owner_settings(session)

    rows = {s.key: s.value for s in session.exec(select(Setting)).all()}
    assert rows == DEFAULT_SETTINGS
    assert all(s.owner_id == 1 for s in session.exec(select(Setting)).all())


def test_ensure_is_idempotent(session):
    bind_owner(session, user_id=1)
    ensure_owner_settings(session)
    ensure_owner_settings(session)
    ensure_owner_settings(session)

    assert len(session.exec(select(Setting)).all()) == len(DEFAULT_SETTINGS)


def test_ensure_does_not_overwrite_existing_values(session):
    bind_owner(session, user_id=1)
    session.add(Setting(key="default_vacation_days", value="42"))
    session.commit()

    ensure_owner_settings(session)

    row = session.exec(select(Setting).where(Setting.key == "default_vacation_days")).first()
    assert row.value == "42"
    assert len(session.exec(select(Setting)).all()) == len(DEFAULT_SETTINGS)


def test_ensure_seeds_each_owner_independently(session):
    bind_owner(session, user_id=1)
    ensure_owner_settings(session)
    bind_owner(session, user_id=2)
    ensure_owner_settings(session)

    # Owner 2 sees only their own copy.
    assert len(session.exec(select(Setting)).all()) == len(DEFAULT_SETTINGS)
    all_rows = _all_rows(session)
    assert len(all_rows) == 2 * len(DEFAULT_SETTINGS)
    assert {s.owner_id for s in all_rows} == {1, 2}


def test_ensure_swallows_concurrent_insert_race(session, monkeypatch):
    """Rows already exist, but the existence pre-check is forced to miss (as it
    would if two requests both saw an empty owner at once), so ensure retries the
    INSERTs and trips the per-owner UNIQUE constraint — which must be swallowed."""
    bind_owner(session, user_id=1)
    ensure_owner_settings(session)  # 6 rows now exist for owner 1

    class _Empty:
        def all(self):
            return []

    monkeypatch.setattr(session, "exec", lambda *_a, **_k: _Empty())
    ensure_owner_settings(session)  # must not raise despite UNIQUE collisions
    monkeypatch.undo()

    rows = {s.key: s.value for s in session.exec(select(Setting)).all()}
    assert rows == DEFAULT_SETTINGS
