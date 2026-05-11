# Step 03 — Holiday Service

_Branch: `feature/holiday-service`_

## Goal

Implement `app/services/holiday.py`: fetch public holidays from external APIs, cache
them in the `Holiday` table, and expose a query function used by the planning service.

---

## API Sources

### Primary — feiertage-api.de

```
GET https://feiertage-api.de/api/?jahr={year}&nur_land={state}
```
Only supports Germany (country=DE).

Response (flat dict, keys = holiday names):
```json
{
  "Neujahrstag": {"datum": "2026-01-01", "hinweis": ""},
  "Heilige Drei Könige": {"datum": "2026-01-06", "hinweis": ""},
  ...
}
```

### Fallback — OpenHolidays API

```
GET https://openholidaysapi.org/PublicHolidays
    ?countryIsoCode={country}
    &validFrom={year}-01-01&validTo={year}-12-31
    &subdivisionCode={country}-{state}
    &languageIsoCode=DE
```

Response (array):
```json
[
  {
    "startDate": "2026-01-01",
    "endDate":   "2026-01-01",
    "name": [{"language": "DE", "text": "Neujahrstag"}]
  },
  ...
]
```

---

## Service Design

### Public interface (`app/services/holiday.py`)

```python
class HolidayFetchError(Exception):
    """Raised when holiday data can't be fetched and the year isn't cached."""

def ensure_holidays(
    year: int,
    country: str,
    state: str,
    session: Session,
    client: httpx.Client | None = None,
) -> list[Holiday]:
    """
    Return cached holidays for year/country/state.
    If not yet cached, fetch from primary API; fall back to secondary; raise on failure.
    """

def get_holidays_in_range(
    start: date,
    end: date,
    country: str,
    state: str,
    session: Session,
    client: httpx.Client | None = None,
) -> list[Holiday]:
    """
    Return all Holiday records in [start, end] (inclusive) for country/state.
    Ensures every year in the range is cached first.
    Raises HolidayFetchError if any required year can't be fetched.
    """
```

### Caching strategy

- A year is considered "already cached" when ≥ 1 Holiday row exists for
  `(year, country, state)`.  A partial cache (e.g. from a previous interrupted
  fetch) is re-fetched — the UniqueConstraint silently discards duplicates via
  ON CONFLICT IGNORE.
- `ensure_holidays` is idempotent: calling it twice for the same key is a no-op
  after the first call succeeds.

### `is_workday` rule

`is_workday = holiday_date.weekday() < 5`  (Monday=0 … Friday=4)

### Error handling

| Scenario | Behaviour |
|---|---|
| Primary API returns non-200 | Try fallback |
| Primary API raises network error | Try fallback |
| Fallback also fails | Raise `HolidayFetchError` |
| Year already cached | Return from DB, no network call |

---

## Files to create

| File | Purpose |
|---|---|
| `backend/app/services/holiday.py` | Service implementation |
| `backend/tests/unit/test_services_holiday.py` | Unit tests (mocked HTTP) |

---

## Test list

### Unit tests (all HTTP mocked)

| # | Test | Type |
|---|---|---|
| 1 | `test_ensure_holidays_fetches_and_caches` | happy path, primary API |
| 2 | `test_ensure_holidays_cache_hit_skips_network` | cache already populated |
| 3 | `test_ensure_holidays_fallback_on_primary_http_error` | primary returns 500 |
| 4 | `test_ensure_holidays_fallback_on_primary_network_error` | primary raises ConnectError |
| 5 | `test_ensure_holidays_raises_when_both_apis_fail` | both return 500 |
| 6 | `test_weekday_holiday_has_is_workday_true` | is_workday logic |
| 7 | `test_weekend_holiday_has_is_workday_false` | is_workday logic |
| 8 | `test_ensure_holidays_is_idempotent` | second call is no-op |
| 9 | `test_get_holidays_in_range_single_year` | date filtering |
| 10 | `test_get_holidays_in_range_spans_two_years` | ensures both years cached |
| 11 | `test_get_holidays_in_range_excludes_out_of_range` | boundary correctness |
| 12 | `test_get_holidays_in_range_empty_when_none_in_period` | no holidays in range |
| 13 | `@given` all returned holidays are within [start, end] | property-based |
| 14 | `@given` is_workday matches weekday check | property-based |

---

## Acceptance criteria

- All 14+ tests pass, coverage ≥ 90 % for the service module.
- `ensure_holidays` never makes a network call when the year is already cached.
- `HolidayFetchError` is raised (not swallowed) when both APIs are unavailable and
  the year is not cached.
- Calling `ensure_holidays` twice for the same key never raises a UniqueConstraint
  error.
