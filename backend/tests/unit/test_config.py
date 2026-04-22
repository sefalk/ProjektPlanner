"""
Unit tests for application configuration.

Covers: default values, env var overrides, .env.example completeness.
"""

import os
from pathlib import Path

import pytest

from app.config import Settings


def test_database_url_has_default() -> None:
    """Settings must always provide a DATABASE_URL, even without a .env file."""
    settings = Settings()
    assert settings.database_url
    assert "sqlite" in settings.database_url


def test_holiday_api_url_has_default() -> None:
    settings = Settings()
    assert settings.holiday_api_url.startswith("https://")


def test_holiday_api_url_overridable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOLIDAY_API_URL", "https://example.com/holidays")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.holiday_api_url == "https://example.com/holidays"


def test_default_holiday_country_is_de() -> None:
    settings = Settings()
    assert settings.default_holiday_country == "DE"


def test_default_holiday_state_is_by() -> None:
    settings = Settings()
    assert settings.default_holiday_state == "BY"


def test_env_example_covers_all_settings_fields() -> None:
    """Every field in Settings must appear as a key in .env.example.

    This prevents the example file from going stale as new settings are added.
    """
    env_example = Path(__file__).parent.parent.parent / ".env.example"
    assert env_example.exists(), ".env.example file not found"

    example_keys = set()
    for line in env_example.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            example_keys.add(line.split("=", 1)[0].strip())

    for field_name in Settings.model_fields:
        env_key = field_name.upper()
        assert env_key in example_keys, (
            f"Settings field '{field_name}' (env key '{env_key}') "
            f"is missing from .env.example"
        )
