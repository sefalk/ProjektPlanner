"""Resolve which holiday region (country/state) applies, plus optional extras.

Single seam for holiday-region resolution so later phases extend it without
touching callers:

- Phase 1: always the config default.
- Phase 5 (now): read the global app settings (Setting store) as override of
  config, plus a catalog of optionally-activated local holidays.
- Phase 6: honor a per-person override (``person`` arg) above the global value.
"""

from __future__ import annotations

from datetime import date

from sqlmodel import Session

from app.config import settings as config
from app.models.person import Person
from app.models.setting import Setting

# Setting keys (seeded in db.seed_default_settings)
KEY_COUNTRY = "holiday_country"
KEY_STATE = "holiday_state"
KEY_EXTRA = "holiday_extra"  # CSV of activated catalog keys below

# Optional local holidays that the public APIs don't reliably return for a
# state. Fixed-date only (movable feasts like Fronleichnam are already covered
# statewide where they apply). name is the German label shown in the calendar.
EXTRA_HOLIDAY_CATALOG: dict[str, dict] = {
    "mariae_himmelfahrt": {"name": "Mariä Himmelfahrt", "month": 8, "day": 15},
    "augsburger_friedensfest": {"name": "Augsburger Friedensfest", "month": 8, "day": 8},
    "reformationstag": {"name": "Reformationstag", "month": 10, "day": 31},
}


def _get(session: Session, key: str, default: str) -> str:
    row = session.get(Setting, key)
    return row.value if row and row.value else default


def resolve_holiday_region(
    session: Session,
    person: Person | None = None,
) -> tuple[str, str]:
    """Return the (country, state) whose holidays apply for ``person``.

    A per-person override (WP6) wins over the global setting; NULL fields on the
    person inherit the corresponding global value independently.
    """
    country = _get(session, KEY_COUNTRY, config.default_holiday_country)
    state = _get(session, KEY_STATE, config.default_holiday_state)
    if person is not None:
        if person.holiday_country:
            country = person.holiday_country
        if person.holiday_state:
            state = person.holiday_state
    return country, state


def get_active_extra_keys(session: Session) -> list[str]:
    """Activated optional-local-holiday keys from settings (valid ones only)."""
    raw = _get(session, KEY_EXTRA, "")
    return [k for k in (s.strip() for s in raw.split(",")) if k in EXTRA_HOLIDAY_CATALOG]


def extra_holiday_dates(year: int, keys: list[str]) -> list[tuple[str, date]]:
    """(name, date) for each activated catalog key in the given year."""
    out: list[tuple[str, date]] = []
    for key in keys:
        entry = EXTRA_HOLIDAY_CATALOG.get(key)
        if entry:
            out.append((entry["name"], date(year, entry["month"], entry["day"])))
    return out
