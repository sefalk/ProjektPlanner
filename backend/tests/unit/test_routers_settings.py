"""Unit tests for GET/PUT /settings and GET/PUT /settings/database-path endpoints."""

import json
from pathlib import Path
from unittest.mock import patch

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


# ---------------------------------------------------------------------------
# GET /settings/database-path
# ---------------------------------------------------------------------------


def test_get_database_path_returns_info(client):
    r = client.get("/settings/database-path")
    assert r.status_code == 200
    data = r.json()
    assert "path" in data
    assert "url" in data
    assert "config_source" in data
    assert isinstance(data["cloud_warning"], bool)


def test_get_database_path_url_is_sqlite(client):
    r = client.get("/settings/database-path")
    assert r.json()["url"].startswith("sqlite:///")


# ---------------------------------------------------------------------------
# PUT /settings/database-path
# ---------------------------------------------------------------------------


def test_set_database_path_copies_and_updates(client, tmp_path):
    # Create a fake source DB file so shutil.copy2 has something to copy
    fake_db = tmp_path / "source" / "projektplanner.db"
    fake_db.parent.mkdir()
    fake_db.write_bytes(b"SQLite format 3\x00")

    config_file = tmp_path / "data_config.json"
    target_dir = tmp_path / "target"

    with (
        patch("app.services.db_management._CONFIG_FILE", config_file),
        patch("app.services.db_management._live_db_path", return_value=fake_db),
    ):
        r = client.put("/settings/database-path", json={"directory": str(target_dir)})

    assert r.status_code == 200
    data = r.json()
    assert data["restart_required"] is True
    assert "projektplanner.db" in data["new_path"]
    # Config file should have been written
    assert config_file.exists()
    cfg = json.loads(config_file.read_text())
    assert "database_url" in cfg


def test_set_database_path_empty_dir_returns_422(client):
    r = client.put("/settings/database-path", json={"directory": "   "})
    assert r.status_code == 422


def test_set_database_path_same_dir_returns_422(client, tmp_path):
    fake_db = tmp_path / "projektplanner.db"
    fake_db.write_bytes(b"SQLite format 3\x00")
    config_file = tmp_path / "data_config.json"

    with (
        patch("app.services.db_management._CONFIG_FILE", config_file),
        patch("app.services.db_management._live_db_path", return_value=fake_db),
    ):
        r = client.put("/settings/database-path", json={"directory": str(tmp_path)})

    assert r.status_code == 422


def test_set_database_path_cloud_warning(client, tmp_path):
    fake_db = tmp_path / "projektplanner.db"
    fake_db.write_bytes(b"SQLite format 3\x00")
    config_file = tmp_path / "data_config.json"
    onedrive_dir = tmp_path / "OneDrive" / "data"

    with (
        patch("app.services.db_management._CONFIG_FILE", config_file),
        patch("app.services.db_management._live_db_path", return_value=fake_db),
    ):
        r = client.put("/settings/database-path", json={"directory": str(onedrive_dir)})

    assert r.status_code == 200
    assert r.json()["cloud_warning"] is True
