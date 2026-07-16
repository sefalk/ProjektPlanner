"""CRUD tests for /projects and nested /billing-positions + /memberships endpoints."""
from datetime import date


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": "Test Project",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "total_budget_euros": 50000.0,
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


# ---------------------------------------------------------------------------
# Billing positions — Projektposten CRUD & budget consistency (doc 21 WP2)
# ---------------------------------------------------------------------------

def test_create_position_defaults_to_open_difference(client):
    p = client.post("/projects", json=_project()).json()  # 50000 budget
    bp = client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "billing_rate_per_hour": 100.0,
    }).json()
    # No budget given → defaults to the full open difference (50000).
    assert bp["budget_euros"] == 50000.0
    assert bp["billing_rate_per_hour"] == 100.0


def test_create_position_overshoot_blocked(client):
    p = client.post("/projects", json=_project()).json()  # 50000
    client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 40000.0,
    })
    r = client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P2", "budget_euros": 20000.0,
    })
    assert r.status_code == 409


def test_update_position(client):
    p = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 10000.0,
    }).json()
    r = client.put(f"/projects/{p['id']}/billing-positions/{bp['id']}", json={
        "position_number": "P1b", "budget_euros": 25000.0, "billing_rate_per_hour": 120.0,
    })
    assert r.status_code == 200
    assert r.json()["budget_euros"] == 25000.0
    assert r.json()["billing_rate_per_hour"] == 120.0


def test_update_position_overshoot_blocked(client):
    p = client.post("/projects", json=_project()).json()  # 50000
    bp1 = client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 30000.0,
    }).json()
    client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P2", "budget_euros": 15000.0,
    })
    # Raising P1 to 40000 → Σ = 55000 > 50000 → blocked.
    r = client.put(f"/projects/{p['id']}/billing-positions/{bp1['id']}", json={
        "position_number": "P1", "budget_euros": 40000.0,
    })
    assert r.status_code == 409


def test_budget_state_reports_open_and_complete(client):
    p = client.post("/projects", json=_project()).json()  # 50000
    client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 30000.0,
    })
    s = client.get(f"/projects/{p['id']}/billing-positions/budget-state").json()
    assert s["allocated_euros"] == 30000.0
    assert s["open_euros"] == 20000.0
    assert s["is_complete"] is False
    assert s["is_over"] is False

    client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P2", "budget_euros": 20000.0,
    })
    s2 = client.get(f"/projects/{p['id']}/billing-positions/budget-state").json()
    assert s2["is_complete"] is True
    assert s2["open_euros"] == 0.0


def test_delete_position_blocked_when_member_assigned(client):
    p = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{p['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 10000.0,
    }).json()
    person = client.post("/persons", json=_person_payload()).json()
    client.post(f"/projects/{p['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
        "billing_position_id": bp["id"],
    })
    r = client.delete(f"/projects/{p['id']}/billing-positions/{bp['id']}")
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Member → position assignment (doc 21 WP4, §P2)
# ---------------------------------------------------------------------------

def _priced_position(client, project_id, number="A", budget=50000.0, rate=100.0):
    return client.post(f"/projects/{project_id}/billing-positions", json={
        "position_number": number, "budget_euros": budget, "billing_rate_per_hour": rate,
    }).json()


def _enable_position_mode(client, project_id):
    return client.put(f"/projects/{project_id}/position-mode", json={"enabled": True})


def test_enable_position_mode_guard_and_toggle(client):
    p = client.post("/projects", json=_project()).json()  # budget 50000
    # No priced position, budget unallocated → cannot enable.
    r = client.get(f"/projects/{p['id']}/position-mode").json()
    assert r["enabled"] is False and r["can_enable"] is False
    assert _enable_position_mode(client, p["id"]).status_code == 409
    # Add a priced position covering the full budget → now enable succeeds.
    _priced_position(client, p["id"], budget=50000.0)
    ok = _enable_position_mode(client, p["id"])
    assert ok.status_code == 200 and ok.json()["position_mode"] is True


def test_position_mode_requires_assignment(client):
    p = client.post("/projects", json=_project()).json()
    _priced_position(client, p["id"], budget=50000.0)
    assert _enable_position_mode(client, p["id"]).status_code == 200
    person = client.post("/persons", json=_person_payload()).json()
    # Adding a member without a position is now rejected (position mode on).
    r = client.post(f"/projects/{p['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
    })
    assert r.status_code == 400


def test_enable_blocked_by_unassigned_member(client):
    p = client.post("/projects", json=_project()).json()
    _priced_position(client, p["id"], budget=50000.0)
    person = client.post("/persons", json=_person_payload()).json()
    client.post(f"/projects/{p['id']}/memberships", json={  # unassigned member (simple mode)
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
    })
    status = client.get(f"/projects/{p['id']}/position-mode").json()
    assert status["can_enable"] is False
    assert _enable_position_mode(client, p["id"]).status_code == 409


def test_position_mode_assignment_accepted(client):
    p = client.post("/projects", json=_project()).json()
    bp = _priced_position(client, p["id"], budget=50000.0)
    assert _enable_position_mode(client, p["id"]).status_code == 200
    person = client.post("/persons", json=_person_payload()).json()
    r = client.post(f"/projects/{p['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 0.0,
        "billing_position_id": bp["id"],
    })
    assert r.status_code == 201
    assert r.json()["billing_position_id"] == bp["id"]


def test_assignment_to_foreign_position_rejected(client):
    # Foreign-position FK check applies in either mode (no toggle needed).
    p1 = client.post("/projects", json=_project("P00001")).json()
    p2 = client.post("/projects", json=_project("P00002")).json()
    bp2 = _priced_position(client, p2["id"])  # belongs to p2
    person = client.post("/persons", json=_person_payload()).json()
    r = client.post(f"/projects/{p1['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 0.0,
        "billing_position_id": bp2["id"],  # foreign position
    })
    assert r.status_code == 400


def test_simple_mode_no_assignment_needed(client):
    # Position mode off → assignment optional (regression guard).
    p = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    r = client.post(f"/projects/{p['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
    })
    assert r.status_code == 201


def test_sage_levels_from_bookings(client, session):
    # Distinct, project-scoped Sage levels from bookings (finding 2026-07-16, WP5 UX).
    from datetime import date as _date, datetime as _dt
    from app.models.timebooking import ImportBatch, TimeBooking

    p = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    batch = ImportBatch(project_id=p["id"], imported_at=_dt(2026, 1, 31),
                        last_booking_date=_date(2026, 1, 15))
    session.add(batch); session.flush()
    for i, level in enumerate(["Development", "Development", "Test", ""]):
        session.add(TimeBooking(
            booking_date=_date(2026, 1, 10), person_id=person["id"], project_id=p["id"],
            import_batch_id=batch.id, sage_project_name="X", sage_project_level=level, net_hours=1.0 + i))
    session.commit()

    levels = client.get(f"/projects/{p['id']}/sage-levels").json()
    assert levels == ["Development", "Test"]  # distinct, sorted, blanks dropped


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


# ---------------------------------------------------------------------------
# Referential actions (V11, WP3)
# ---------------------------------------------------------------------------


def _short_project(number: str) -> dict:
    return {**_project(number), "start_date": "2026-01-01", "end_date": "2026-03-31"}


def _setup_initialized(client, number: str):
    """Create a 3-month project with one full-range member and initialize milestones."""
    proj = client.post("/projects", json=_short_project(number)).json()
    person = client.post("/persons", json=_person_payload()).json()
    m = client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-03-31",
        "weekly_capacity_hours": 40.0, "billing_rate_per_hour": 90.0,
    }).json()
    client.post(f"/projects/{proj['id']}/milestones/initialize")
    return proj, person, m


def test_delete_membership_removes_open_milestone_budgets(client):
    proj, person, m = _setup_initialized(client, "PDEL01")
    detail = client.get(f"/projects/{proj['id']}/milestones/detail").json()
    assert all(len(d["persons"]) == 1 for d in detail)

    assert client.delete(f"/projects/{proj['id']}/memberships/{m['id']}").status_code == 204

    detail = client.get(f"/projects/{proj['id']}/milestones/detail").json()
    assert all(d["persons"] == [] for d in detail)
    assert all(d["milestone"]["current_hours"] == 0.0 for d in detail)


def test_project_date_shrink_removes_out_of_range_milestones(client):
    proj, person, m = _setup_initialized(client, "PDATE01")
    assert len(client.get(f"/projects/{proj['id']}/milestones").json()) == 3

    # Shrink to February only.
    r = client.put(f"/projects/{proj['id']}", json={
        **_short_project("PDATE01"), "start_date": "2026-02-01", "end_date": "2026-02-28",
    })
    assert r.status_code == 200
    months = {(x["year"], x["month"]) for x in client.get(f"/projects/{proj['id']}/milestones").json()}
    assert months == {(2026, 2)}


def test_membership_date_shrink_prunes_budgets(client):
    proj, person, m = _setup_initialized(client, "PMDATE01")

    # Membership shrinks to February only.
    r = client.put(f"/projects/{proj['id']}/memberships/{m['id']}", json={
        "from_date": "2026-02-01", "to_date": "2026-02-28",
        "weekly_capacity_hours": 40.0, "billing_rate_per_hour": 90.0,
    })
    assert r.status_code == 200

    detail = {(d["milestone"]["year"], d["milestone"]["month"]): d
              for d in client.get(f"/projects/{proj['id']}/milestones/detail").json()}
    assert detail[(2026, 1)]["persons"] == []
    assert len(detail[(2026, 2)]["persons"]) == 1
    assert detail[(2026, 3)]["persons"] == []


def test_membership_vacation_days_taken_roundtrip(client):
    proj = client.post("/projects", json=_project()).json()
    person = client.post("/persons", json=_person_payload()).json()
    m = client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 40.0, "billing_rate_per_hour": 90.0, "vacation_days_taken": 12.0,
    }).json()
    assert m["vacation_days_taken"] == 12.0
    upd = client.put(f"/projects/{proj['id']}/memberships/{m['id']}", json={
        "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 40.0, "billing_rate_per_hour": 90.0, "vacation_days_taken": 5.0,
    }).json()
    assert upd["vacation_days_taken"] == 5.0
    assert client.get(f"/projects/{proj['id']}/memberships").json()[0]["vacation_days_taken"] == 5.0


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
