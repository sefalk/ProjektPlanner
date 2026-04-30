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
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings
from app.services.db_management import resolve_db_url

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


def seed_default_settings() -> None:
    """Insert default settings rows if they do not yet exist."""
    from app.models.setting import Setting  # local import avoids circular deps at module load

    defaults = {
        "default_vacation_days": "30",
        "sick_days_per_year": "10",
        "training_days_per_year": "5",
    }
    with Session(engine) as session:
        for key, value in defaults.items():
            if session.get(Setting, key) is None:
                session.add(Setting(key=key, value=value))
        session.commit()


def get_session() -> Generator[Session, None, None]:  # pragma: no cover
    """FastAPI dependency that yields a database session per request.

    Always overridden in tests via app.dependency_overrides — the real
    implementation is infrastructure glue, not business logic to test here.
    """
    with Session(engine) as session:
        yield session
