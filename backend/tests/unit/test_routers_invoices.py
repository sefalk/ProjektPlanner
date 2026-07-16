"""Tests for invoice / month-close router endpoints."""


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": f"Project {number}",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "total_budget_euros": 50000.0,
        "total_budget_hours": 500.0,
    }


def _person(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


def _close_body(billing_position_id: int, year: int = 2026, month: int = 1) -> dict:
    return {"year": year, "month": month, "billing_position_id": billing_position_id}


def _setup(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person()).json()
    bp = client.post(
        f"/projects/{proj['id']}/billing-positions",
        json={"position_number": "BP1", "description": "Dev", "budget_euros": 50000.0},
    ).json()
    client.post(
        f"/projects/{proj['id']}/memberships",
        json={
            "person_id": person["id"],
            "from_date": "2026-01-01",
            "to_date": "2026-03-31",
            "weekly_capacity_hours": 40.0,
            "billing_rate_per_hour": 90.0,
        },
    )
    return proj["id"], bp["id"]


# ---------------------------------------------------------------------------
# POST /projects/{id}/invoices/close
# ---------------------------------------------------------------------------


def test_close_returns_201(client):
    proj_id, bp_id = _setup(client)
    r = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id))
    assert r.status_code == 201
    data = r.json()[0]
    assert data["total_hours"] == 0.0
    assert data["status"] == "planned"


def test_close_project_not_found(client):
    r = client.post("/projects/9999/invoices/close", json=_close_body(1))
    assert r.status_code == 404


def test_close_billing_position_not_found(client):
    proj_id, _ = _setup(client)
    r = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(9999))
    assert r.status_code == 404


def test_close_already_closed_returns_409(client):
    proj_id, bp_id = _setup(client)
    client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id))
    r = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id))
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# GET /projects/{id}/invoices
# ---------------------------------------------------------------------------


def test_list_invoices_empty(client):
    proj_id, _ = _setup(client)
    r = client.get(f"/projects/{proj_id}/invoices")
    assert r.status_code == 200
    assert r.json() == []


def test_list_invoices_after_close(client):
    proj_id, bp_id = _setup(client)
    client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id))
    r = client.get(f"/projects/{proj_id}/invoices")
    assert len(r.json()) == 1


def test_list_invoices_project_not_found(client):
    assert client.get("/projects/9999/invoices").status_code == 404


# ---------------------------------------------------------------------------
# GET /invoices/{id}
# ---------------------------------------------------------------------------


def test_get_invoice(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    r = client.get(f"/invoices/{inv['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == inv["id"]


def test_get_invoice_not_found(client):
    assert client.get("/invoices/9999").status_code == 404


# ---------------------------------------------------------------------------
# GET /invoices/{id}/entries
# ---------------------------------------------------------------------------


def test_get_entries_not_found(client):
    assert client.get("/invoices/9999/entries").status_code == 404


def test_get_entries_empty(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    r = client.get(f"/invoices/{inv['id']}/entries")
    assert r.status_code == 200
    assert r.json() == []


# ---------------------------------------------------------------------------
# DELETE /invoices/{id}  (reopen)
# ---------------------------------------------------------------------------


def test_reopen_returns_204(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    r = client.delete(f"/invoices/{inv['id']}")
    assert r.status_code == 204


def test_reopen_removes_invoice(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    client.delete(f"/invoices/{inv['id']}")
    assert client.get(f"/invoices/{inv['id']}").status_code == 404


def test_reopen_invoiced_returns_204(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    client.put(f"/invoices/{inv['id']}/status", json={"status": "invoiced"})
    r = client.delete(f"/invoices/{inv['id']}")
    assert r.status_code == 204


def test_reopen_not_found(client):
    assert client.delete("/invoices/9999").status_code == 404


# ---------------------------------------------------------------------------
# PUT /invoices/{id}/status
# ---------------------------------------------------------------------------


def test_status_update_to_invoiced(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    r = client.put(f"/invoices/{inv['id']}/status", json={"status": "invoiced"})
    assert r.status_code == 200
    assert r.json()["status"] == "invoiced"


def test_status_update_invalid_transition_returns_409(client):
    proj_id, bp_id = _setup(client)
    inv = client.post(f"/projects/{proj_id}/invoices/close", json=_close_body(bp_id)).json()[0]
    r = client.put(f"/invoices/{inv['id']}/status", json={"status": "paid"})
    assert r.status_code == 409


def test_status_update_not_found(client):
    r = client.put("/invoices/9999/status", json={"status": "invoiced"})
    assert r.status_code == 404
