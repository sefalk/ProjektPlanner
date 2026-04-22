"""CRUD tests for /programs endpoints."""
import pytest


def _program(number: str = "P00001") -> dict:
    return {"program_number": number, "name": "Test Program", "customer": "ACME"}


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def test_list_programs_empty(client):
    r = client.get("/programs")
    assert r.status_code == 200
    assert r.json() == []


def test_list_programs_returns_created(client):
    client.post("/programs", json=_program())
    r = client.get("/programs")
    assert len(r.json()) == 1


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def test_create_program_returns_201(client):
    r = client.post("/programs", json=_program())
    assert r.status_code == 201
    data = r.json()
    assert data["program_number"] == "P00001"
    assert data["id"] is not None


def test_create_program_duplicate_number_returns_409(client):
    client.post("/programs", json=_program())
    r = client.post("/programs", json=_program())
    assert r.status_code == 409


def test_create_program_invalid_body_returns_422(client):
    r = client.post("/programs", json={"name": "X"})  # missing required fields
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Get one
# ---------------------------------------------------------------------------

def test_get_program_returns_200(client):
    created = client.post("/programs", json=_program()).json()
    r = client.get(f"/programs/{created['id']}")
    assert r.status_code == 200
    assert r.json()["program_number"] == "P00001"


def test_get_program_not_found_returns_404(client):
    r = client.get("/programs/9999")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def test_update_program(client):
    created = client.post("/programs", json=_program()).json()
    r = client.put(f"/programs/{created['id']}", json={**_program(), "name": "Updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"


def test_update_program_not_found_returns_404(client):
    r = client.put("/programs/9999", json=_program())
    assert r.status_code == 404


def test_update_program_duplicate_number_returns_409(client):
    client.post("/programs", json=_program("P00001"))
    p2 = client.post("/programs", json=_program("P00002")).json()
    r = client.put(f"/programs/{p2['id']}", json={**_program("P00001"), "name": "X"})
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_program_returns_204(client):
    created = client.post("/programs", json=_program()).json()
    r = client.delete(f"/programs/{created['id']}")
    assert r.status_code == 204


def test_delete_program_not_found_returns_404(client):
    r = client.delete("/programs/9999")
    assert r.status_code == 404


def test_delete_program_removes_from_list(client):
    created = client.post("/programs", json=_program()).json()
    client.delete(f"/programs/{created['id']}")
    assert client.get("/programs").json() == []
