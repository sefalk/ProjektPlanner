"""Resolve which holiday region (country/state) applies.

Single seam for holiday-region resolution so later phases can extend it without
touching callers:

- Phase 1 (now): always the global default from config.
- Phase 5: read global app settings (Setting store) as override of config.
- Phase 6: honor a per-person override (``person`` arg) above the global value.
"""

from __future__ import annotations

from app.config import settings
from app.models.person import Person


def resolve_holiday_region(
    session,  # noqa: ANN001 — Session, kept loose to avoid import cycle churn
    person: Person | None = None,
) -> tuple[str, str]:
    """Return the (country, state) whose holidays apply for ``person``.

    ``person`` is accepted already so Phase 6 can add per-person overrides here
    without changing the endpoint signatures that call this.
    """
    return settings.default_holiday_country, settings.default_holiday_state
