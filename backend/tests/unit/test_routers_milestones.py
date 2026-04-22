"""CRUD tests for /projects/{id}/milestones and nested /budgets endpoints."""
from datetime import date


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": f"Project {number}",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "total_budget_hours": 500.0,
    }


def _person(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


def _membership(project_id: int, person_id: int) -> dict:
    return {
        "person_id": person_id,
        "from_date": "2026-01-01",
        "to_date": "2026-03-31",
        "weekly_capacity_hours": 40.0,
        "billing_rate_per_hour": 90.0,
    }


def _setup(client):
    """Create project + person + membership; return (project_id, person_id)."""
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person()).json()
    client.post(f"/projects/{proj['id']}/memberships", json=_membership(proj["id"], person["id"]))
    return proj["id"], person["id"]


# ---------------------------------------------------------------------------
# POST /projects/{id}/milestones/initialize
# ---------------------------------------------------------------------------


def test_initialize_milestones_returns_201(client):
    proj_id, _ = _setup(client)
    r = client.post(f"/projects/{proj_id}/milestones/initialize")
    assert r.status_code == 201
    assert len(r.json()) == 3  # Jan, Feb, Mar


def test_initialize_milestones_project_not_found(client):
    assert client.post("/projects/9999/milestones/initialize").status_code == 404


def test_initialize_milestones_idempotent(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    r2 = client.post(f"/projects/{proj_id}/milestones/initialize")
    assert r2.status_code == 201
    assert r2.json() == []  # nothing new created


def test_initialize_milestones_hours_positive(client):
    proj_id, _ = _setup(client)
    milestones = client.post(f"/projects/{proj_id}/milestones/initialize").json()
    assert all(m["initial_hours"] > 0 for m in milestones)


# ---------------------------------------------------------------------------
# GET /projects/{id}/milestones
# ---------------------------------------------------------------------------


def test_list_milestones_empty_before_init(client):
    proj_id, _ = _setup(client)
    r = client.get(f"/projects/{proj_id}/milestones")
    assert r.status_code == 200
    assert r.json() == []


def test_list_milestones_after_init(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    r = client.get(f"/projects/{proj_id}/milestones")
    assert len(r.json()) == 3


def test_list_milestones_project_not_found(client):
    assert client.get("/projects/9999/milestones").status_code == 404


def test_list_milestones_ordered_by_month(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    milestones = client.get(f"/projects/{proj_id}/milestones").json()
    months = [(m["year"], m["month"]) for m in milestones]
    assert months == sorted(months)


# ---------------------------------------------------------------------------
# GET /projects/{id}/milestones/{mid}
# ---------------------------------------------------------------------------


def test_get_milestone(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.get(f"/projects/{proj_id}/milestones/{ms['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == ms["id"]


def test_get_milestone_wrong_project(client):
    proj1_id, _ = _setup(client)
    proj2 = client.post("/projects", json={**_project("P00002"), "name": "P2"}).json()
    ms = client.post(f"/projects/{proj1_id}/milestones/initialize").json()[0]
    assert client.get(f"/projects/{proj2['id']}/milestones/{ms['id']}").status_code == 404


def test_get_milestone_not_found(client):
    proj_id, _ = _setup(client)
    assert client.get(f"/projects/{proj_id}/milestones/9999").status_code == 404


# ---------------------------------------------------------------------------
# GET /projects/{id}/milestones/{mid}/budgets
# ---------------------------------------------------------------------------


def test_list_budgets(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets")
    assert r.status_code == 200
    assert len(r.json()) == 1  # one member


def test_list_budgets_milestone_not_found(client):
    proj_id, _ = _setup(client)
    assert client.get(f"/projects/{proj_id}/milestones/9999/budgets").status_code == 404


# ---------------------------------------------------------------------------
# PUT /projects/{id}/milestones/{mid}/budgets/{bid}
# ---------------------------------------------------------------------------


def test_update_budget(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    budget = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]
    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{budget['id']}",
        json={"current_hours": 100.0},
    )
    assert r.status_code == 200
    assert r.json()["current_hours"] == 100.0


def test_update_budget_syncs_milestone(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    budget = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]
    client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{budget['id']}",
        json={"current_hours": 50.0},
    )
    updated_ms = client.get(f"/projects/{proj_id}/milestones/{ms['id']}").json()
    assert updated_ms["current_hours"] == 50.0


def test_update_budget_not_found(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/9999",
        json={"current_hours": 10.0},
    )
    assert r.status_code == 404


def test_update_budget_milestone_not_found(client):
    proj_id, _ = _setup(client)
    r = client.put(
        f"/projects/{proj_id}/milestones/9999/budgets/1",
        json={"current_hours": 10.0},
    )
    assert r.status_code == 404
