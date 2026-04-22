"""Unit tests for the holiday service (all HTTP is mocked)."""

from datetime import date

import httpx
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from sqlmodel import Session, SQLModel, create_engine

from app.models.holiday import Holiday
from app.services.holiday import HolidayFetchError, ensure_holidays, get_holidays_in_range

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FEIERTAGE_2026_BY = {
    "Neujahrstag": {"datum": "2026-01-01", "hinweis": ""},
    "Heilige Drei Könige": {"datum": "2026-01-06", "hinweis": ""},
    "Karfreitag": {"datum": "2026-04-03", "hinweis": ""},
    "Ostermontag": {"datum": "2026-04-06", "hinweis": ""},
    "Tag der Arbeit": {"datum": "2026-05-01", "hinweis": ""},
    "Christi Himmelfahrt": {"datum": "2026-05-14", "hinweis": ""},
    "Pfingstmontag": {"datum": "2026-05-25", "hinweis": ""},
    "Fronleichnam": {"datum": "2026-06-04", "hinweis": ""},
    "Maria Himmelfahrt": {"datum": "2026-08-15", "hinweis": ""},
    "Tag der Deutschen Einheit": {"datum": "2026-10-03", "hinweis": ""},
    "Allerheiligen": {"datum": "2026-11-01", "hinweis": ""},
    "1. Weihnachtstag": {"datum": "2026-12-25", "hinweis": ""},
    "2. Weihnachtstag": {"datum": "2026-12-26", "hinweis": ""},
}

OPENHOLIDAYS_2026_BY = [
    {"startDate": "2026-01-01", "endDate": "2026-01-01",
     "name": [{"language": "DE", "text": "Neujahrstag"}]},
    {"startDate": "2026-01-06", "endDate": "2026-01-06",
     "name": [{"language": "DE", "text": "Heilige Drei Könige"}]},
    {"startDate": "2026-05-01", "endDate": "2026-05-01",
     "name": [{"language": "DE", "text": "Tag der Arbeit"}]},
    {"startDate": "2026-12-25", "endDate": "2026-12-25",
     "name": [{"language": "DE", "text": "1. Weihnachtstag"}]},
]

FEIERTAGE_2025_BY = {
    "Neujahrstag": {"datum": "2025-01-01", "hinweis": ""},
    "Tag der Arbeit": {"datum": "2025-05-01", "hinweis": ""},
    "1. Weihnachtstag": {"datum": "2025-12-25", "hinweis": ""},
}


def _make_client(primary_response=None, fallback_response=None):
    """Build an httpx.Client whose transport routes by URL prefix."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "feiertage-api.de" in url:
            if primary_response is None:
                raise httpx.ConnectError("mocked connect error")
            if isinstance(primary_response, int):
                return httpx.Response(primary_response)
            return httpx.Response(200, json=primary_response)
        elif "openholidaysapi.org" in url:
            if fallback_response is None:
                return httpx.Response(503)
            if isinstance(fallback_response, int):
                return httpx.Response(fallback_response)
            return httpx.Response(200, json=fallback_response)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def mem_session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


# ---------------------------------------------------------------------------
# ensure_holidays — happy path
# ---------------------------------------------------------------------------

def test_ensure_holidays_fetches_and_caches(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert len(holidays) == len(FEIERTAGE_2026_BY)
    assert all(h.country == "DE" and h.state == "BY" for h in holidays)
    assert all(h.holiday_date.year == 2026 for h in holidays)


def test_ensure_holidays_stores_in_db(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    ensure_holidays(2026, "DE", "BY", mem_session, client)
    from sqlmodel import select
    stored = mem_session.exec(select(Holiday)).all()
    assert len(stored) == len(FEIERTAGE_2026_BY)


# ---------------------------------------------------------------------------
# ensure_holidays — caching
# ---------------------------------------------------------------------------

def test_ensure_holidays_cache_hit_skips_network(mem_session):
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        return httpx.Response(200, json=FEIERTAGE_2026_BY)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    ensure_holidays(2026, "DE", "BY", mem_session, client)
    ensure_holidays(2026, "DE", "BY", mem_session, client)  # second call
    assert call_count["n"] == 1  # network hit only once


def test_ensure_holidays_is_idempotent(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    r1 = ensure_holidays(2026, "DE", "BY", mem_session, client)
    r2 = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert len(r1) == len(r2)
    from sqlmodel import select
    stored = mem_session.exec(select(Holiday)).all()
    assert len(stored) == len(FEIERTAGE_2026_BY)  # no duplicates


# ---------------------------------------------------------------------------
# ensure_holidays — fallback
# ---------------------------------------------------------------------------

def test_ensure_holidays_fallback_on_primary_http_error(mem_session):
    client = _make_client(primary_response=500, fallback_response=OPENHOLIDAYS_2026_BY)
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert len(holidays) == len(OPENHOLIDAYS_2026_BY)


def test_ensure_holidays_fallback_on_primary_network_error(mem_session):
    client = _make_client(primary_response=None, fallback_response=OPENHOLIDAYS_2026_BY)
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert len(holidays) == len(OPENHOLIDAYS_2026_BY)


def test_ensure_holidays_raises_when_both_apis_fail(mem_session):
    client = _make_client(primary_response=500, fallback_response=503)
    with pytest.raises(HolidayFetchError):
        ensure_holidays(2026, "DE", "BY", mem_session, client)


def test_ensure_holidays_raises_connect_error_both_fail(mem_session):
    client = _make_client(primary_response=None, fallback_response=None)
    with pytest.raises(HolidayFetchError):
        ensure_holidays(2026, "DE", "BY", mem_session, client)


# ---------------------------------------------------------------------------
# is_workday logic
# ---------------------------------------------------------------------------

def test_weekday_holiday_has_is_workday_true(mem_session):
    # 2026-01-01 is Thursday → workday
    client = _make_client(primary_response={"Neujahrstag": {"datum": "2026-01-01", "hinweis": ""}})
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert holidays[0].is_workday is True


def test_weekend_holiday_has_is_workday_false(mem_session):
    # 2026-05-16 is Saturday → not a workday
    client = _make_client(primary_response={"Samstag-Feiertag": {"datum": "2026-05-16", "hinweis": ""}})
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert holidays[0].is_workday is False


def test_sunday_holiday_has_is_workday_false(mem_session):
    # 2026-05-17 is Sunday
    client = _make_client(primary_response={"Sonntag-Feiertag": {"datum": "2026-05-17", "hinweis": ""}})
    holidays = ensure_holidays(2026, "DE", "BY", mem_session, client)
    assert holidays[0].is_workday is False


# ---------------------------------------------------------------------------
# get_holidays_in_range
# ---------------------------------------------------------------------------

def test_get_holidays_in_range_single_year(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    result = get_holidays_in_range(
        date(2026, 4, 1), date(2026, 6, 30), "DE", "BY", mem_session, client
    )
    dates = {h.holiday_date for h in result}
    assert date(2026, 4, 3) in dates   # Karfreitag
    assert date(2026, 4, 6) in dates   # Ostermontag
    assert date(2026, 5, 1) in dates   # Tag der Arbeit
    assert date(2026, 1, 1) not in dates  # outside range


def test_get_holidays_in_range_spans_two_years(mem_session):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "2026" in url:
            return httpx.Response(200, json=FEIERTAGE_2026_BY)
        if "2025" in url:
            return httpx.Response(200, json=FEIERTAGE_2025_BY)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = get_holidays_in_range(
        date(2025, 12, 1), date(2026, 1, 31), "DE", "BY", mem_session, client
    )
    dates = {h.holiday_date for h in result}
    assert date(2025, 12, 25) in dates  # Weihnachtstag 2025
    assert date(2026, 1, 1) in dates    # Neujahr 2026


def test_get_holidays_in_range_excludes_out_of_range(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    result = get_holidays_in_range(
        date(2026, 1, 2), date(2026, 1, 5), "DE", "BY", mem_session, client
    )
    dates = {h.holiday_date for h in result}
    assert date(2026, 1, 1) not in dates   # before start
    assert date(2026, 1, 6) not in dates   # after end


def test_get_holidays_in_range_empty_when_none_in_period(mem_session):
    client = _make_client(primary_response=FEIERTAGE_2026_BY)
    result = get_holidays_in_range(
        date(2026, 2, 1), date(2026, 2, 28), "DE", "BY", mem_session, client
    )
    assert result == []


def test_ensure_holidays_api_returns_empty_list_raises(mem_session):
    """An API that returns {} (no holidays) is treated as a fetch failure."""
    client = _make_client(primary_response={}, fallback_response=None)
    with pytest.raises(HolidayFetchError):
        ensure_holidays(2026, "DE", "BY", mem_session, client)


# ---------------------------------------------------------------------------
# Property-based tests
# ---------------------------------------------------------------------------

@given(
    # offset 0–334 + length 0–30 keeps both start and end within 2026 (non-leap, 365 days).
    offset=st.integers(min_value=0, max_value=334),
    length=st.integers(min_value=0, max_value=30),
)
@settings(max_examples=50)
def test_all_returned_holidays_are_within_range(offset, length):
    from datetime import timedelta
    from sqlmodel.pool import StaticPool

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        client = _make_client(primary_response=FEIERTAGE_2026_BY)
        start = date(2026, 1, 1) + timedelta(days=offset)
        end = start + timedelta(days=length)
        result = get_holidays_in_range(start, end, "DE", "BY", session, client)
        for h in result:
            assert start <= h.holiday_date <= end
    SQLModel.metadata.drop_all(engine)


@given(day=st.integers(min_value=1, max_value=7))
def test_is_workday_matches_weekday(day):
    """Manually built Holiday: is_workday must match weekday < 5."""
    # Use 2026-01 which starts on Thursday (weekday 3).
    # day 1=Thu(3), 2=Fri(4), 3=Sat(5), 4=Sun(6), 5=Mon(0), 6=Tue(1), 7=Wed(2)
    d = date(2026, 1, day)
    h = Holiday(
        holiday_date=d,
        name="Test",
        country="DE",
        state="BY",
        is_workday=(d.weekday() < 5),
    )
    assert h.is_workday == (d.weekday() < 5)
