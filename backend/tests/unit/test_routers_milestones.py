"""CRUD tests for /projects/{id}/milestones and nested /budgets endpoints."""
from datetime import date


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


def test_initialize_milestones_without_members_returns_422(client):
    """§8.1: a project without any active member cannot be initialized (backend guard)."""
    proj = client.post("/projects", json=_project("PNOMEM")).json()
    r = client.post(f"/projects/{proj['id']}/milestones/initialize")
    assert r.status_code == 422
    assert "member" in r.json()["detail"].lower()
    # Guard runs before any mutation → no milestones created.
    assert client.get(f"/projects/{proj['id']}/milestones").json() == []


def test_resync_project_not_found(client):
    assert client.post("/projects/9999/milestones/resync").status_code == 404


def test_resync_adds_new_member_scaled(client):
    """Adding a member and calling resync inserts a scaled budget row (BUG-4, non-destructive)."""
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")

    # Add a second member after initialization.
    person2 = client.post("/persons", json=_person("Second Member")).json()
    client.post(f"/projects/{proj_id}/memberships", json=_membership(proj_id, person2["id"]))

    r = client.post(f"/projects/{proj_id}/milestones/resync")
    assert r.status_code == 200
    body = r.json()
    assert body["added"] >= 1
    assert set(body.keys()) == {"added", "removed", "recomputed", "changed_milestone_ids"}

    # New member now appears in the per-person breakdown.
    detail = client.get(f"/projects/{proj_id}/milestones/detail").json()
    assert all(len(d["persons"]) == 2 for d in detail)


def test_recommendations_project_not_found(client):
    assert client.get("/projects/9999/milestones/recommendations").status_code == 404


def test_recommendations_endpoint_returns_underbooked_member(client):
    """A member using less than their general weekly capacity yields a recommendation (V8)."""
    proj = client.post("/projects", json=_project("PREC01")).json()
    person = client.post("/persons", json=_person()).json()
    # 20 of 40 h/week used → 20 h free.
    client.post(f"/projects/{proj['id']}/memberships", json={
        **_membership(proj["id"], person["id"]), "weekly_capacity_hours": 20.0,
    })
    client.post(f"/projects/{proj['id']}/milestones/initialize")

    r = client.get(f"/projects/{proj['id']}/milestones/recommendations")
    assert r.status_code == 200
    recs = r.json()
    assert len(recs) == 1
    assert recs[0]["person_id"] == person["id"]
    assert recs[0]["free_weekly_hours"] == 20.0
    assert recs[0]["recommended_additional_hours"] > 0


def test_set_target_budget_redistributes_hours(client):
    """Setting a month's € target drives the hours to hit it (A)."""
    proj_id, _ = _setup(client)  # budget 50000, rate 90, 3 months
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]

    r = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/target-budget", json={"target_euros": 4500.0})
    assert r.status_code == 200
    body = r.json()
    assert abs(body["achieved_euros"] - 4500.0) < 1e-6  # 50 h × 90
    assert body["milestone"]["target_budget_euros"] == 4500.0

    budgets = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()
    total_cost = sum(b["current_hours"] * 90.0 for b in budgets)
    assert abs(total_cost - 4500.0) < 1e-6


def test_set_target_budget_locked_returns_409(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    # close the month to lock it
    bpos = client.post(f"/projects/{proj_id}/billing-positions",
                       json={"position_number": "BP", "description": "", "budget_euros": 1000.0}).json()
    client.post(f"/projects/{proj_id}/invoices/close",
                json={"year": ms["year"], "month": ms["month"], "billing_position_id": bpos["id"]})
    r = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/target-budget", json={"target_euros": 1000.0})
    assert r.status_code == 409


def test_set_target_budget_milestone_not_found(client):
    proj_id, _ = _setup(client)
    r = client.put(f"/projects/{proj_id}/milestones/9999/target-budget", json={"target_euros": 1000.0})
    assert r.status_code == 404


def test_clear_target_budget_unlocks(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    client.put(f"/projects/{proj_id}/milestones/{ms['id']}/target-budget", json={"target_euros": 4500.0})
    r = client.delete(f"/projects/{proj_id}/milestones/{ms['id']}/target-budget")
    assert r.status_code == 200
    assert r.json()["target_budget_euros"] is None


def _budget_id(client, proj_id, ms_id, person_id) -> int:
    detail = client.get(f"/projects/{proj_id}/milestones/detail").json()
    return next(
        p["budget_id"]
        for m in detail if m["milestone"]["id"] == ms_id
        for p in m["persons"] if p["person_id"] == person_id
    )


def test_hours_lock_toggle(client):
    proj_id, person_id = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    bid = _budget_id(client, proj_id, ms["id"], person_id)
    r = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{bid}/lock", json={"locked": True})
    assert r.status_code == 200
    assert r.json()["is_manual_override"] is True
    r2 = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{bid}/lock", json={"locked": False})
    assert r2.json()["is_manual_override"] is False


def test_estimated_absence_override_endpoint(client):
    proj_id, person_id = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    bid = _budget_id(client, proj_id, ms["id"], person_id)
    r = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{bid}/estimated-absence", json={"days": 4.0})
    assert r.status_code == 200
    assert r.json()["estimated_absence_days_override"] == 4.0
    # clear
    r2 = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{bid}/estimated-absence", json={"days": None})
    assert r2.json()["estimated_absence_days_override"] is None
    # negative → 422
    r3 = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{bid}/estimated-absence", json={"days": -2.0})
    assert r3.status_code == 422


def test_recalc_preview_endpoint(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    r = client.get(f"/projects/{proj_id}/milestones/recalc-preview")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3  # Jan-Mar
    assert all("suggested_total_hours" in s and "budgets" in s for s in body)


def test_planning_lock_toggle_and_status(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/planning-lock", json={"locked": True})
    assert r.status_code == 200
    assert r.json()["is_planning_locked"] is True
    # locked month is excluded from the recalc preview
    preview = client.get(f"/projects/{proj_id}/milestones/recalc-preview").json()
    assert ms["id"] not in [s["milestone_id"] for s in preview]
    # unlock
    r2 = client.put(f"/projects/{proj_id}/milestones/{ms['id']}/planning-lock", json={"locked": False})
    assert r2.json()["is_planning_locked"] is False


def test_detail_exposes_estimate_breakdown(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    d = client.get(f"/projects/{proj_id}/milestones/detail").json()
    p = d[0]["persons"][0]
    for k in ("vacation_estimate_days", "sick_estimate_days", "training_estimate_days"):
        assert k in p


def test_detail_zero_hours_month_flagged(client):
    """A month with personnel but zero planned hours is flagged with a warning (§8.1)."""
    proj_id, person_id = _setup(client)
    ms_list = client.post(f"/projects/{proj_id}/milestones/initialize").json()
    ms = ms_list[0]
    # Force this month to 0 h despite the member being assigned.
    client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/persons/{person_id}",
        json={"current_hours": 0.0},
    )
    detail = client.get(f"/projects/{proj_id}/milestones/detail").json()
    flagged = next(d for d in detail if d["milestone"]["id"] == ms["id"])
    assert len(flagged["warnings"]) >= 1
    assert "planbaren Stunden" in flagged["warnings"][0]


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


def test_update_budget_sets_override_flag(client):
    """A manual edit flags the row as an override and echoes an (empty) warnings list (V6)."""
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    budget = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]
    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{budget['id']}",
        json={"current_hours": 10.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_manual_override"] is True
    assert body["warnings"] == []


def test_update_budget_over_budget_requires_confirm(client):
    """Exceeding the euro budget without confirm → 409 with warnings, no save (§8.2)."""
    proj_id, _ = _setup(client)  # budget 50000 €, rate 90 €/h
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    budget = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]

    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{budget['id']}",
        json={"current_hours": 2000.0},  # 2000×90 = 180000 » 50000
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["warnings"]
    assert any("Budget" in w for w in detail["warnings"])

    # Not saved.
    after = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]
    assert after["current_hours"] != 2000.0
    assert after["is_manual_override"] is False


def test_update_budget_over_budget_with_confirm_saves(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    budget = client.get(f"/projects/{proj_id}/milestones/{ms['id']}/budgets").json()[0]

    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/budgets/{budget['id']}?confirm=true",
        json={"current_hours": 2000.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["current_hours"] == 2000.0
    assert body["is_manual_override"] is True
    assert any("Budget" in w for w in body["warnings"])


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


# ---------------------------------------------------------------------------
# GET /projects/{id}/milestones/detail
# ---------------------------------------------------------------------------


def test_get_milestones_detail_project_not_found(client):
    assert client.get("/projects/9999/milestones/detail").status_code == 404


def test_get_milestones_detail_empty_before_init(client):
    proj_id, _ = _setup(client)
    r = client.get(f"/projects/{proj_id}/milestones/detail")
    assert r.status_code == 200
    assert r.json() == []


def test_get_milestones_detail_after_init(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    r = client.get(f"/projects/{proj_id}/milestones/detail")
    assert r.status_code == 200
    details = r.json()
    assert len(details) == 3  # Jan, Feb, Mar
    # Each detail has milestone and persons list
    for d in details:
        assert "milestone" in d
        assert "persons" in d
        assert len(d["persons"]) == 1  # one member
        p = d["persons"][0]
        assert "person_id" in p
        assert "initial_hours" in p
        assert "current_hours" in p
        assert "work_days" in p
        assert "absence_days" in p
        assert "holiday_days" in p
        assert "billing_rate_per_hour" in p
        assert "booked_hours" in p
        assert isinstance(p["booked_hours"], float)


def test_get_milestones_detail_initial_hours_positive(client):
    proj_id, _ = _setup(client)
    client.post(f"/projects/{proj_id}/milestones/initialize")
    details = client.get(f"/projects/{proj_id}/milestones/detail").json()
    for d in details:
        for p in d["persons"]:
            assert p["initial_hours"] > 0


# ---------------------------------------------------------------------------
# PUT /projects/{id}/milestones/{mid}/persons/{pid}
# ---------------------------------------------------------------------------


def test_put_person_budget_by_person_id(client):
    proj_id, person_id = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/persons/{person_id}",
        json={"current_hours": 42.0},
    )
    assert r.status_code == 200
    assert r.json()["current_hours"] == 42.0


def test_put_person_budget_syncs_milestone(client):
    proj_id, person_id = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/persons/{person_id}",
        json={"current_hours": 33.0},
    )
    updated = client.get(f"/projects/{proj_id}/milestones/{ms['id']}").json()
    assert updated["current_hours"] == 33.0


def test_put_person_budget_milestone_not_found(client):
    proj_id, person_id = _setup(client)
    r = client.put(
        f"/projects/{proj_id}/milestones/9999/persons/{person_id}",
        json={"current_hours": 10.0},
    )
    assert r.status_code == 404


def test_put_person_budget_person_not_in_milestone(client):
    proj_id, _ = _setup(client)
    ms = client.post(f"/projects/{proj_id}/milestones/initialize").json()[0]
    r = client.put(
        f"/projects/{proj_id}/milestones/{ms['id']}/persons/9999",
        json={"current_hours": 10.0},
    )
    assert r.status_code == 404
