"""Unit tests for GET/PUT /settings endpoints."""

from app.models.setting import Setting


def _seed_setting(client, key: str = "default_vacation_days", value: str = "30"):
    """Insert a setting row directly via session (settings are seeded by migration; use client fixture)."""
    # The in-memory DB has no migration data, so we create the row via the session
    # available in the fixture through the DB override.
    # We can POST to verify via client; here we use a helper that inserts directly.
    return key, value


def _put_setting_via_session(session, key: str, value: str):
    s = Setting(key=key, value=value)
    session.add(s)
    session.commit()


# ---------------------------------------------------------------------------
# GET /settings
# ---------------------------------------------------------------------------


def test_get_settings_empty(client):
    r = client.get("/settings")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_get_settings_returns_seeded_values(client, session):
    _put_setting_via_session(session, "default_vacation_days", "30")
    r = client.get("/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["default_vacation_days"] == "30"


def test_get_settings_multiple_keys(client, session):
    _put_setting_via_session(session, "key_a", "alpha")
    _put_setting_via_session(session, "key_b", "beta")
    r = client.get("/settings")
    data = r.json()
    assert data["key_a"] == "alpha"
    assert data["key_b"] == "beta"


# ---------------------------------------------------------------------------
# PUT /settings/{key}
# ---------------------------------------------------------------------------


def test_update_setting(client, session):
    _put_setting_via_session(session, "default_vacation_days", "30")
    r = client.put("/settings/default_vacation_days", json={"value": "25"})
    assert r.status_code == 200
    assert r.json()["value"] == "25"


def test_update_setting_persists(client, session):
    _put_setting_via_session(session, "default_vacation_days", "30")
    client.put("/settings/default_vacation_days", json={"value": "20"})
    r = client.get("/settings")
    assert r.json()["default_vacation_days"] == "20"


def test_update_setting_not_found(client):
    r = client.put("/settings/nonexistent_key", json={"value": "42"})
    assert r.status_code == 404
