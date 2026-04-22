"""
Application configuration loaded from environment variables / .env file.

All runtime settings are declared here as a single Pydantic Settings class.
Never hardcode values — add them here and to .env.example instead.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = "sqlite:///./data/projektplanner.db"

    # Holiday API
    holiday_api_url: str = "https://feiertage-api.de/api/"
    holiday_api_fallback_url: str = "https://openholidaysapi.org"
    default_holiday_country: str = "DE"
    default_holiday_state: str = "BY"

    # Application
    app_version: str = "0.1.0"
    debug: bool = False


# Module-level singleton — import this where settings are needed.
settings = Settings()
