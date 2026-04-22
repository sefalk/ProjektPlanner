"""Tests for /projects/{id}/rebalancing/* endpoints."""
from datetime import date


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": f"Project {number}",
        "start_date": "2026-01-01",
        "end_date": "2026-02-28",
        "total_budget_hours": 500.0,
    }


def _person(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


def _membership(person_id: int, weekly_hours: float = 40.0) -> dict:
    return {
        "person_id": person_id,
        "from_date": "2026-01-01",
        "to_date": "2026-02-28",
        "weekly_capacity_hours": weekly_hours,
        "billing_rate_per_hour": 90.0,
    }


def _setup(client):
    proj = client.post("/projects", json=_project()).json()
    alice = client.post("/persons", json=_person("Alice")).json()
    bob = client.post("/persons", json=_person("Bob")).json()
    client.post(f"/projects/{proj['id']}/memberships", json=_membership(alice["id"], 40.0))
    client.post(f"/projects/{proj['id']}/memberships", json=_membership(bob["id"], 20.0))
    client.post(f"/projects/{proj['id']}/milestones/initialize")
    return proj["id"]


# ---------------------------------------------------------------------------
# GET /projects/{id}/rebalancing/drift
# ---------------------------------------------------------------------------


def test_get_drift_returns_200(client):
    proj_id = _setup(client)
    r = client.get(f"/projects/{proj_id}/rebalancing/drift")
    assert r.status_code == 200
    assert len(r.json()) == 2  # Alice + Bob


def test_get_drift_no_bookings_negative_drift(client):
    proj_id = _setup(client)
    drifts = client.get(f"/projects/{proj_id}/rebalancing/drift").json()
    for d in drifts:
        assert d["drift_hours"] < 0  # nothing booked


def test_get_drift_project_not_found(client):
    assert client.get("/projects/9999/rebalancing/drift").status_code == 404


def test_get_drift_no_milestones(client):
    proj = client.post("/projects", json=_project("P00002")).json()
    r = client.get(f"/projects/{proj['id']}/rebalancing/drift")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# GET /projects/{id}/rebalancing/suggestions
# ---------------------------------------------------------------------------


def test_get_suggestions_returns_200(client):
    proj_id = _setup(client)
    r = client.get(f"/projects/{proj_id}/rebalancing/suggestions")
    assert r.status_code == 200
    assert len(r.json()) == 2  # Jan + Feb


def test_get_suggestions_budgets_sum_to_total(client):
    proj_id = _setup(client)
    suggestions = client.get(f"/projects/{proj_id}/rebalancing/suggestions").json()
    for s in suggestions:
        total = sum(b["suggested_hours"] for b in s["budgets"])
        assert abs(total - s["total_current_hours"]) < 0.01


def test_get_suggestions_project_not_found(client):
    assert client.get("/projects/9999/rebalancing/suggestions").status_code == 404


def test_get_suggestions_proportional(client):
    """Alice (40h) should get 2× the allocation of Bob (20h)."""
    proj = client.post("/projects", json=_project("P00003")).json()
    alice = client.post("/persons", json=_person("Alice C")).json()
    bob = client.post("/persons", json=_person("Bob C")).json()
    client.post(f"/projects/{proj['id']}/memberships", json=_membership(alice["id"], 40.0))
    client.post(f"/projects/{proj['id']}/memberships", json=_membership(bob["id"], 20.0))
    client.post(f"/projects/{proj['id']}/milestones/initialize")

    suggestions = client.get(f"/projects/{proj['id']}/rebalancing/suggestions").json()
    first = suggestions[0]
    by_person = {b["person_id"]: b["suggested_hours"] for b in first["budgets"]}
    ratio = by_person[alice["id"]] / by_person[bob["id"]]
    assert abs(ratio - 2.0) < 0.02


# ---------------------------------------------------------------------------
# POST /projects/{id}/rebalancing/apply
# ---------------------------------------------------------------------------


def test_apply_rebalancing_returns_200(client):
    proj_id = _setup(client)
    r = client.post(f"/projects/{proj_id}/rebalancing/apply")
    assert r.status_code == 200
    assert len(r.json()) > 0


def test_apply_rebalancing_project_not_found(client):
    assert client.post("/projects/9999/rebalancing/apply").status_code == 404


def test_apply_rebalancing_updates_budgets(client):
    proj_id = _setup(client)
    client.post(f"/projects/{proj_id}/rebalancing/apply")
    # After apply, suggestions should show no change (already proportional)
    suggestions = client.get(f"/projects/{proj_id}/rebalancing/suggestions").json()
    for s in suggestions:
        for b in s["budgets"]:
            assert abs(b["current_hours"] - b["suggested_hours"]) < 0.01
