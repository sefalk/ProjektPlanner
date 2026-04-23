"""
Database engine and session management.

get_session is a FastAPI dependency injected into all routers.
Tests override it with an in-memory engine via app.dependency_overrides.
"""

from collections.abc import Generator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings

engine = create_engine(
    settings.database_url,
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


def get_session() -> Generator[Session, None, None]:  # pragma: no cover
    """FastAPI dependency that yields a database session per request.

    Always overridden in tests via app.dependency_overrides — the real
    implementation is infrastructure glue, not business logic to test here.
    """
    with Session(engine) as session:
        yield session
