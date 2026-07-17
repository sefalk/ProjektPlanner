"""
Application configuration loaded from environment variables / .env file.

All runtime settings are declared here as a single Pydantic Settings class.
Never hardcode values — add them here and to .env.example instead.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute fallback — always resolves to backend/data/projektplanner.db
# regardless of working directory or uvicorn reload CWD.
_DEFAULT_DB = Path(__file__).parent.parent / "data" / "projektplanner.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = f"sqlite:///{_DEFAULT_DB}"

    # Holiday API
    holiday_api_url: str = "https://feiertage-api.de/api/"
    holiday_api_fallback_url: str = "https://openholidaysapi.org"
    # Foreign holidays (non-DE): Nager.Date covers ~all countries incl. Greece.
    holiday_api_foreign_url: str = "https://date.nager.at/api/v3"
    default_holiday_country: str = "DE"
    default_holiday_state: str = "BY"

    # Application
    app_version: str = "0.2.0"
    debug: bool = False


# Module-level singleton — import this where settings are needed.
settings = Settings()
