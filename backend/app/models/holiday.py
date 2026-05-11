"""Holiday model — cached public holiday data from the holidays API."""

from datetime import date

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import ValidatedSQLModel


class Holiday(ValidatedSQLModel, table=True):
    """A public holiday for a given country/state, fetched from the API and cached.

    is_workday=True means the holiday falls on a weekday and reduces available_days.
    Holidays on weekends are stored but do not affect availability calculations.
    """

    __tablename__ = "holiday"
    __table_args__ = (
        UniqueConstraint("holiday_date", "country", "state", name="uq_holiday_date_country_state"),
    )

    id: int | None = Field(default=None, primary_key=True)
    holiday_date: date = Field(index=True)
    name: str
    country: str = Field(min_length=2, max_length=2)  # ISO 3166-1 alpha-2
    state: str = Field(min_length=2)
    is_workday: bool
