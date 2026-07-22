"""
Database engine and session management.

get_session is a FastAPI dependency injected into all routers.
Tests override it with an in-memory engine via app.dependency_overrides.

The active database URL is resolved at import time via db_management so that
a user-configured path (stored in data_config.json) takes priority over the
DATABASE_URL env var / pydantic default.
"""

from collections.abc import Generator

from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import settings
from app.services.db_management import resolve_db_url

# Default application settings, seeded per owner on first access (doc 25, WP3).
# The read paths (milestones, persons, holiday_region) fall back to these same
# values when a key is absent, so behaviour is identical before and after seeding.
DEFAULT_SETTINGS: dict[str, str] = {
    "default_vacation_days": "30",
    "sick_days_per_year": "10",
    "training_days_per_year": "5",
    # Holiday region for the year calendar. holiday_extra = CSV of activated
    # optional local holidays (keys from EXTRA_HOLIDAY_CATALOG).
    "holiday_country": "DE",
    "holiday_state": "BY",
    "holiday_extra": "",
}

_db_url = resolve_db_url()

engine = create_engine(
    _db_url,
    connect_args={"check_same_thread": False, "timeout": 30},
    echo=settings.debug,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record) -> None:
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()


def create_db_and_tables() -> None:
    """Create all tables. Called once on application startup."""
    SQLModel.metadata.create_all(engine)


def ensure_owner_settings(session: Session) -> None:
    """Seed any missing default settings for the session's current owner (#42, doc 25).

    Per-owner (WP3 step 3b): settings are no longer global, so they can't be
    seeded once at startup — each user needs their own copy. This is called from
    the authenticated settings endpoints, where the session is owner-bound: the
    existence SELECT is auto-scoped to the current owner by the central filter,
    and new rows get their owner_id stamped by the before_flush listener.

    Idempotent and race-safe: each key is inserted in its own transaction and a
    concurrent-insert IntegrityError (two requests seeding the same brand-new
    owner at once) is swallowed as "already seeded".
    """
    from app.models.setting import Setting  # local import avoids circular deps at module load

    existing = {row.key for row in session.exec(select(Setting)).all()}
    for key, value in DEFAULT_SETTINGS.items():
        if key in existing:
            continue
        session.add(Setting(key=key, value=value))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()


def get_session() -> Generator[Session, None, None]:  # pragma: no cover
    """FastAPI dependency that yields a database session per request.

    Always overridden in tests via app.dependency_overrides — the real
    implementation is infrastructure glue, not business logic to test here.
    """
    with Session(engine) as session:
        yield session
