"""Owner-based multi-user isolation (doc 25, WP3).

Exercises the central filter end-to-end via the API: every CRUD router is
auth-guarded, reads are scoped to the caller's owner, inserts are stamped,
owner_id is not client-editable, per-owner uniqueness holds, and superusers
bypass the filter. The `client_for` factory builds clients acting as different
owners against one shared in-memory database, so cross-owner leakage is
directly observable.
"""

from fastapi.testclient import TestClient
from sqlmodel import select

from app.db import get_session
from app.main import app
from app.models.program import Program
from app.tenancy import bypass_owner_filter


def _program(number: str, name: str = "Prog", customer: str = "ACME") -> dict:
    return {"program_number": number, "name": name, "customer": customer}


# ── auth guard ────────────────────────────────────────────────────────────────

def test_crud_routers_require_authentication(session):
    """Without an authenticated user, an owned-resource router returns 401."""
    def override_get_session():
        yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        with TestClient(app) as c:
            assert c.get("/programs").status_code == 401
            assert c.post("/programs", json=_program("P1")).status_code == 401
            assert c.get("/projects").status_code == 401
            assert c.get("/persons").status_code == 401
    finally:
        app.dependency_overrides.clear()


# ── read isolation ──────────────────────────────────────────────────────────

def test_owner_only_sees_own_rows(client_for):
    alice = client_for(user_id=1)
    bob = client_for(user_id=2)

    created = alice.post("/programs", json=_program("A-1")).json()
    assert alice.get("/programs").json()  # alice sees her program
    assert len(alice.get("/programs").json()) == 1

    # Bob sees nothing of Alice's — neither in the list nor by direct id.
    assert bob.get("/programs").json() == []
    assert bob.get(f"/programs/{created['id']}").status_code == 404


def test_insert_is_stamped_with_caller_owner(client_for, session):
    alice = client_for(user_id=1)
    bob = client_for(user_id=2)
    a = alice.post("/programs", json=_program("A-1")).json()
    b = bob.post("/programs", json=_program("B-1")).json()

    with bypass_owner_filter(session):
        by_id = {p.id: p for p in session.exec(select(Program)).all()}
    assert by_id[a["id"]].owner_id == 1
    assert by_id[b["id"]].owner_id == 2


def test_client_cannot_smuggle_owner_id_on_create(client_for, session):
    """A payload-supplied owner_id is ignored — the caller is always the owner."""
    alice = client_for(user_id=1)
    created = alice.post("/programs", json={**_program("A-1"), "owner_id": 999}).json()
    with bypass_owner_filter(session):
        row = session.get(Program, created["id"])
    assert row.owner_id == 1


def test_owner_id_not_editable_via_update(client_for, session):
    alice = client_for(user_id=1)
    created = alice.post("/programs", json=_program("A-1")).json()

    # Try to hand the row to owner 2 via the update body.
    r = alice.put(f"/programs/{created['id']}", json={**_program("A-1", name="Renamed"), "owner_id": 2})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"  # the legit change stuck
    assert r.json()["owner_id"] == 1      # ownership did not

    with bypass_owner_filter(session):
        assert session.get(Program, created["id"]).owner_id == 1
    # Still visible to its real owner.
    assert alice.get(f"/programs/{created['id']}").status_code == 200


# ── per-owner uniqueness ──────────────────────────────────────────────────────

def test_same_number_allowed_across_owners_but_not_within(client_for):
    alice = client_for(user_id=1)
    bob = client_for(user_id=2)

    assert alice.post("/programs", json=_program("SHARED")).status_code == 201
    # Different owner, same number → fine (isolation, no leak of existence).
    assert bob.post("/programs", json=_program("SHARED")).status_code == 201
    # Same owner, same number → rejected.
    assert alice.post("/programs", json=_program("SHARED")).status_code == 409


# ── superuser bypass ──────────────────────────────────────────────────────────

def test_superuser_sees_all_owners(client_for):
    alice = client_for(user_id=1)
    bob = client_for(user_id=2)
    admin = client_for(user_id=99, is_superuser=True)

    alice.post("/programs", json=_program("A-1"))
    bob.post("/programs", json=_program("B-1"))

    numbers = {p["program_number"] for p in admin.get("/programs").json()}
    assert numbers == {"A-1", "B-1"}
