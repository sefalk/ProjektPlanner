"""CRUD tests for /projects and nested /billing-positions + /memberships endpoints."""
from datetime import date


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": "Test Project",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "total_budget_hours": 500.0,
    }


def _person_payload(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def test_create_project_returns_201(client):
    r = client.post("/projects", json=_project())
    assert r.status_code == 201
    data = r.json()
    assert data["project_number"] == "P00001"
    assert data["status"] == "active"
    assert data["holiday_country"] == "DE"


def test_create_project_duplicate_number_returns_409(client):
    client.post("/projects", json=_project())
    r = client.post("/projects", json=_project())
    assert r.status_code == 409


def test_create_project_end_before_start_returns_422(client):
    r = client.post("/projects", json={**_project(), "start_date": "2026-06-01", "end_date": "2026-01-01"})
    assert r.status_code == 422


def test_list_projects(client):
    client.post("/projects", json=_project("P00001"))
    client.post("/projects", json=_project("P00002"))
    r = client.get("/projects")
    assert len(r.json()) == 2


def test_get_project_not_found(client):
    assert client.get("/projects/9999").status_code == 404


def test_update_project_not_found(client):
    assert client.put("/projects/9999", json=_project()).status_code == 404


def test_update_project_duplicate_number_returns_409(client):
    client.post("/projects", json=_project("P00001"))
    p2 = client.post("/projects", json=_project("P00002")).json()
    r = client.put(f"/projects/{p2['id']}", json={**_project("P00001")})
    assert r.status_code == 409


def test_list_billing_positions_project_not_found(client):
    assert client.get("/projects/9999/billing-positions").status_code == 404


def test_delete_billing_position_wrong_project(client):
    p1 = client.post("/projects", json=_project("P00001")).json()
    p2 = client.post("/projects", json=_project("P00002")).json()
    bp = client.post(f"/projects/{p1['id']}/billing-positions", json={
        "position_number": "P1", "description": "A", "budget_euros": 100.0
    }).json()
    assert client.delete(f"/projects/{p2['id']}/billing-positions/{bp['id']}").status_code == 404


def test_list_memberships_project_not_found(client):
    assert client.get("/projects/9999/memberships").status_code == 404


def test_delete_membership_wrong_project(client):
    p1 = client.post("/projects", json=_project("P00001")).json()
    p2 = client.post("/projects", json=_project("P00002")).json()
    person = client.post("/persons", json=_person_payload()).json()
    m = client.post(f"/projects/{p1['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
    }).json()
    assert client.delete(f"/projects/{p2['id']}/memberships/{m['id']}").status_code == 404


def test_update_project(client):
    created = client.post("/projects", json=_project()).json()
    r = client.put(f"/projects/{created['id']}", json={**_project(), "name": "Updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"


def test_delete_project(client):
    created = client.post("/projects", json=_project()).json()
    assert client.delete(f"/projects/{created['id']}").status_code == 204
    assert client.get(f"/projects/{created['id']}").status_code == 404


# ---------------------------------------------------------------------------
# Billing positions
# ---------------------------------------------------------------------------

def test_create_billing_position(client):
    proj = client.post("/projects", json=_project()).json()
    r = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "Pos1", "description": "SW Dev", "budget_euros": 50000.0
    })
    assert r.status_code == 201
    assert r.json()["project_id"] == proj["id"]


def test_billing_position_project_not_found(client):
    r = client.post("/projects/9999/billing-positions", json={
        "position_number": "P1", "description": "X", "budget_euros": 0.0
    })
    assert r.status_code == 404


def test_list_billing_positions(client):
    proj = client.post("/projects", json=_project()).json()
    client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "P1", "description": "A", "budget_euros": 100.0
    })
    r = client.get(f"/projects/{proj['id']}/billing-positions")
    assert len(r.json()) == 1


def test_delete_billing_position(client):
    proj = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "P1", "description": "A", "budget_euros": 100.0
    }).json()
    assert client.delete(f"/projects/{proj['id']}/billing-positions/{bp['id']}").status_code == 204


# ---------------------------------------------------------------------------
# Memberships
# ---------------------------------------------------------------------------

def test_create_membership(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    r = client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0,
        "billing_rate_per_hour": 96.75,
    })
    assert r.status_code == 201
    assert r.json()["project_id"] == proj["id"]


def test_list_memberships(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0,
        "billing_rate_per_hour": 96.75,
    })
    r = client.get(f"/projects/{proj['id']}/memberships")
    assert len(r.json()) == 1


def test_delete_membership(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    m = client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0,
        "billing_rate_per_hour": 96.75,
    }).json()
    assert client.delete(f"/projects/{proj['id']}/memberships/{m['id']}").status_code == 204


def test_create_membership_returns_warnings_field(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    r = client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-06-30",
        "weekly_capacity_hours": 32.0,
        "billing_rate_per_hour": 90.0,
    })
    assert r.status_code == 201
    data = r.json()
    assert "warnings" in data
    assert isinstance(data["warnings"], list)


def test_create_membership_overbooking_produces_warning(client):
    proj1 = client.post("/projects", json=_project("P00001")).json()
    proj2 = client.post("/projects", json=_project("P00002")).json()
    person = client.post("/persons", json=_person_payload()).json()
    # First membership: 40 h/week (100%)
    client.post(f"/projects/{proj1['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-01-01",
        "to_date": "2026-06-30",
        "weekly_capacity_hours": 40.0,
        "billing_rate_per_hour": 90.0,
    })
    # Second membership overlapping: 10 h/week → total 125%
    r = client.post(f"/projects/{proj2['id']}/memberships", json={
        "person_id": person["id"],
        "from_date": "2026-03-01",
        "to_date": "2026-05-31",
        "weekly_capacity_hours": 10.0,
        "billing_rate_per_hour": 90.0,
    })
    assert r.status_code == 201
    data = r.json()
    assert len(data["warnings"]) > 0
    assert "125%" in data["warnings"][0]
