"""Holiday fetch-and-cache service.

Public API:
    ensure_holidays(year, country, state, session, client) -> list[Holiday]
    get_holidays_in_range(start, end, country, state, session, client) -> list[Holiday]

Both functions accept an optional httpx.Client for dependency injection in tests.
In production the module-level singleton is used.
"""

from datetime import date

import httpx
from sqlmodel import Session, select

from app.config import settings
from app.models.holiday import Holiday


class HolidayFetchError(Exception):
    """Raised when holiday data can't be fetched and the year isn't cached."""


def _is_cached(year: int, country: str, state: str, session: Session) -> bool:
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    row = session.exec(
        select(Holiday).where(
            Holiday.country == country,
            Holiday.state == state,
            Holiday.holiday_date >= start,
            Holiday.holiday_date <= end,
        )
    ).first()
    return row is not None


def _get_cached(year: int, country: str, state: str, session: Session) -> list[Holiday]:
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    return list(
        session.exec(
            select(Holiday).where(
                Holiday.country == country,
                Holiday.state == state,
                Holiday.holiday_date >= start,
                Holiday.holiday_date <= end,
            )
        ).all()
    )


def _parse_feiertage_response(
    data: dict, year: int, country: str, state: str
) -> list[Holiday]:
    holidays = []
    for name, info in data.items():
        d = date.fromisoformat(info["datum"])
        holidays.append(
            Holiday(
                holiday_date=d,
                name=name,
                country=country,
                state=state,
                is_workday=d.weekday() < 5,
            )
        )
    return holidays


def _parse_openholidays_response(
    data: list, year: int, country: str, state: str
) -> list[Holiday]:
    holidays = []
    for item in data:
        d = date.fromisoformat(item["startDate"])
        name_entries = item.get("name", [])
        name = next(
            (e["text"] for e in name_entries if e.get("language") == "DE"),
            name_entries[0]["text"] if name_entries else "Holiday",
        )
        holidays.append(
            Holiday(
                holiday_date=d,
                name=name,
                country=country,
                state=state,
                is_workday=d.weekday() < 5,
            )
        )
    return holidays


def _fetch_primary(
    year: int, country: str, state: str, client: httpx.Client
) -> list[Holiday]:
    url = f"{settings.holiday_api_url}?jahr={year}&nur_land={state}"
    response = client.get(url)
    response.raise_for_status()
    return _parse_feiertage_response(response.json(), year, country, state)


def _fetch_fallback(
    year: int, country: str, state: str, client: httpx.Client
) -> list[Holiday]:
    url = (
        f"{settings.holiday_api_fallback_url}/PublicHolidays"
        f"?countryIsoCode={country}"
        f"&validFrom={year}-01-01&validTo={year}-12-31"
        f"&subdivisionCode={country}-{state}"
        f"&languageIsoCode=DE"
    )
    response = client.get(url)
    response.raise_for_status()
    return _parse_openholidays_response(response.json(), year, country, state)


def _store(holidays: list[Holiday], session: Session) -> None:
    if not holidays:
        return
    # Skip holidays that are already in the DB (partial-cache safety, idempotency).
    existing: set[tuple] = set(
        session.exec(
            select(Holiday.holiday_date, Holiday.country, Holiday.state)
        ).all()
    )
    new_holidays = [
        h for h in holidays
        if (h.holiday_date, h.country, h.state) not in existing
    ]
    for holiday in new_holidays:
        session.add(holiday)
    if new_holidays:
        session.commit()
        for holiday in new_holidays:
            session.refresh(holiday)


def ensure_holidays(
    year: int,
    country: str,
    state: str,
    session: Session,
    client: httpx.Client | None = None,
) -> list[Holiday]:
    """Return cached holidays for year/country/state, fetching from API if needed.

    Tries primary API first, falls back to secondary on any error.
    Raises HolidayFetchError if both fail and year is not in cache.
    """
    if _is_cached(year, country, state, session):
        return _get_cached(year, country, state, session)

    http = client or httpx.Client()
    holidays: list[Holiday] | None = None
    primary_succeeded = False

    try:
        holidays = _fetch_primary(year, country, state, http)
        primary_succeeded = True
    except (httpx.HTTPError, httpx.ConnectError):
        pass

    if not primary_succeeded:
        try:
            holidays = _fetch_fallback(year, country, state, http)
        except (httpx.HTTPError, httpx.ConnectError):
            pass

    if holidays is None:
        # Both APIs threw — no result at all
        raise HolidayFetchError(
            f"Could not fetch holidays for {year}/{country}/{state}. "
            "Both APIs unavailable and no cached data found."
        )

    # holidays may be [] — valid when the year has no public holidays
    if holidays:
        _store(holidays, session)
    return holidays


def get_holidays_in_range(
    start: date,
    end: date,
    country: str,
    state: str,
    session: Session,
    client: httpx.Client | None = None,
) -> list[Holiday]:
    """Return all Holiday records in [start, end] (inclusive) for country/state.

    Ensures every year in the range is cached first.
    Raises HolidayFetchError if any required year can't be fetched.
    """
    for year in range(start.year, end.year + 1):
        ensure_holidays(year, country, state, session, client)

    return list(
        session.exec(
            select(Holiday).where(
                Holiday.country == country,
                Holiday.state == state,
                Holiday.holiday_date >= start,
                Holiday.holiday_date <= end,
            )
        ).all()
    )
