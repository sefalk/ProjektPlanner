"""
Shared pytest fixtures for all test suites.

The in-memory SQLite engine fixture ensures tests never touch disk and
are fully isolated from each other.

Multi-user (doc 25, WP3): the central owner-filter is driven by an owner bound
onto the Session (``session.info["owner"]``). The ``client`` fixture binds a
default test owner and overrides the ``owner_context`` auth dependency so the
huge existing integration suite keeps passing without real login cookies — every
row a test creates is owned by, and visible to, that one test owner, so the
filter is transparent. Pure model/unit tests that use only the ``session``
fixture get NO owner bound, so they can exercise raw cross-owner behaviour.
Use ``client_for(user_id=..., is_superuser=...)`` to simulate other owners/admin.
"""

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.auth.deps import owner_context
from app.db import get_session
from app.main import app
from app.models.user import User
from app.tenancy import bind_owner, clear_owner

# Default identity every `client`-based test acts as.
TEST_OWNER_ID = 1


@pytest.fixture(name="engine")
def engine_fixture():
    """In-memory SQLite engine, recreated for every test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


@pytest.fixture(name="session")
def session_fixture(engine):
    """Database session bound to the in-memory engine (no owner bound)."""
    with Session(engine) as session:
        yield session


def _fake_owner(user_id: int, is_superuser: bool) -> User:
    """A User instance for dependency return values — never persisted."""
    return User(
        id=user_id,
        email=f"owner{user_id}@test.local",
        hashed_password="x",
        is_active=True,
        is_superuser=is_superuser,
        is_verified=True,
    )


def _bind_client(session, user_id: int, is_superuser: bool) -> TestClient:
    """Wire dependency overrides for a client acting as the given owner."""
    def override_get_session():
        yield session

    def override_owner_context():
        # Bind on every request so switching owners mid-test takes effect, and
        # so handlers that inject `Depends(owner_context)` receive a user.
        bind_owner(session, user_id=user_id, is_superuser=is_superuser)
        return _fake_owner(user_id, is_superuser)

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[owner_context] = override_owner_context
    # Bind immediately too, so direct `session.add(...)` in the test body (before
    # the first request) is owner-scoped and stamped consistently.
    bind_owner(session, user_id=user_id, is_superuser=is_superuser)
    return TestClient(app)


@pytest.fixture(name="client")
def client_fixture(session):
    """TestClient acting as the default test owner (id=1, non-superuser)."""
    with _bind_client(session, TEST_OWNER_ID, is_superuser=False) as c:
        yield c
    app.dependency_overrides.clear()
    clear_owner(session)


@pytest.fixture(name="client_for")
def client_for_fixture(session):
    """Factory: build independent TestClients acting as different owners / admin.

    All clients share the one in-memory session, so cross-owner isolation can be
    asserted against a single database. Each client tags its requests with owner
    headers; a single override binds the session owner PER REQUEST from those
    headers, so interleaving calls from several owners resolves correctly (a
    per-client closure override would not — there is only one override slot).
    """
    def override_get_session():
        yield session

    def override_owner_context(request: Request):
        user_id = int(request.headers["x-test-owner-id"])
        is_superuser = request.headers.get("x-test-superuser") == "1"
        bind_owner(session, user_id=user_id, is_superuser=is_superuser)
        return _fake_owner(user_id, is_superuser)

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[owner_context] = override_owner_context

    created: list[TestClient] = []

    def _make(user_id: int = TEST_OWNER_ID, is_superuser: bool = False) -> TestClient:
        c = TestClient(app, headers={
            "x-test-owner-id": str(user_id),
            "x-test-superuser": "1" if is_superuser else "0",
        })
        created.append(c)
        return c

    yield _make
    for c in created:
        c.close()
    app.dependency_overrides.clear()
    clear_owner(session)
