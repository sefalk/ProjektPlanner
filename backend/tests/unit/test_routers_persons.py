"""CRUD tests for /persons, /absences and /vacation-contingents endpoints."""


def _person(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


# ---------------------------------------------------------------------------
# Persons
# ---------------------------------------------------------------------------

def test_create_person_returns_201(client):
    r = client.post("/persons", json=_person())
    assert r.status_code == 201
    assert r.json()["name"] == "Max Mustermann"


def test_create_person_duplicate_sage_name_returns_409(client):
    client.post("/persons", json=_person())
    r = client.post("/persons", json=_person())
    assert r.status_code == 409


def test_create_person_invalid_hours_returns_422(client):
    r = client.post("/persons", json={**_person(), "default_weekly_hours": 0.0})
    assert r.status_code == 422


def test_list_persons(client):
    client.post("/persons", json=_person("Alice"))
    client.post("/persons", json=_person("Bob"))
    assert len(client.get("/persons").json()) == 2


def test_get_person(client):
    created = client.post("/persons", json=_person()).json()
    r = client.get(f"/persons/{created['id']}")
    assert r.status_code == 200


def test_get_person_not_found(client):
    assert client.get("/persons/9999").status_code == 404


def test_update_person(client):
    created = client.post("/persons", json=_person()).json()
    r = client.put(f"/persons/{created['id']}", json={**_person(), "name": "Updated"})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"


def test_delete_person(client):
    created = client.post("/persons", json=_person()).json()
    assert client.delete(f"/persons/{created['id']}").status_code == 204
    assert client.get(f"/persons/{created['id']}").status_code == 404


def test_person_memberships_carry_priority_and_position(client):
    """Regression (#48): the person view edits assignments and must round-trip priority /
    vacation_days_taken / billing_position_id so an edit there doesn't reset them."""
    person = client.post("/persons", json=_person()).json()
    proj = client.post("/projects", json={
        "project_number": "P00042", "name": "T", "start_date": "2026-01-01",
        "end_date": "2026-12-31", "total_budget_euros": 50000.0, "total_budget_hours": 500.0,
    }).json()
    bp = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "P1", "budget_euros": 10000.0,
    }).json()
    client.post(f"/projects/{proj['id']}/memberships", json={
        "person_id": person["id"], "from_date": "2026-01-01", "to_date": "2026-12-31",
        "weekly_capacity_hours": 32.0, "billing_rate_per_hour": 96.75,
        "priority": 2, "vacation_days_taken": 5.0, "billing_position_id": bp["id"],
    })
    row = client.get(f"/persons/{person['id']}/memberships").json()[0]
    assert row["priority"] == 2
    assert row["vacation_days_taken"] == 5.0
    assert row["billing_position_id"] == bp["id"]


def test_with_projects_returns_full_person_fields(client):
    """Regression: the persons-table edit form is fed from /with-projects.

    It must carry every editable Person field (billing rate, work-week pattern,
    holiday region) so re-saving a person does not null out unshown values.
    """
    created = client.post("/persons", json={
        **_person(),
        "work_week_pattern": "8,8,8,8,0",
        "default_billing_rate": 95.0,
        "holiday_country": "AT",
        "holiday_state": "9",
    }).json()
    rows = client.get("/persons/with-projects").json()
    row = next(r for r in rows if r["id"] == created["id"])
    assert row["work_week_pattern"] == "8,8,8,8,0"
    assert row["default_billing_rate"] == 95.0
    assert row["holiday_country"] == "AT"
    assert row["holiday_state"] == "9"
    assert row["project_numbers"] == []


# ---------------------------------------------------------------------------
# Absences
# ---------------------------------------------------------------------------

def test_create_absence(client):
    person = client.post("/persons", json=_person()).json()
    r = client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-06-01",
        "end_date": "2026-06-10",
        "absence_type": "vacation",
        "status": "planned",
    })
    assert r.status_code == 201
    assert r.json()["person_id"] == person["id"]


def test_create_absence_invalid_status_returns_422(client):
    person = client.post("/persons", json=_person()).json()
    r = client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-06-01",
        "end_date": "2026-06-10",
        "absence_type": "sick",
        "status": "planned",  # invalid for sick
    })
    assert r.status_code == 422


def test_list_absences(client):
    person = client.post("/persons", json=_person()).json()
    client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-06-01", "end_date": "2026-06-05",
        "absence_type": "vacation", "status": "planned",
    })
    r = client.get(f"/persons/{person['id']}/absences")
    assert len(r.json()) == 1


def test_update_absence(client):
    person = client.post("/persons", json=_person()).json()
    absence = client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-06-01", "end_date": "2026-06-10",
        "absence_type": "vacation", "status": "planned",
    }).json()
    r = client.put(f"/persons/{person['id']}/absences/{absence['id']}", json={
        "start_date": "2026-06-01", "end_date": "2026-06-10",
        "absence_type": "vacation", "status": "confirmed",
    })
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"


def test_delete_absence(client):
    person = client.post("/persons", json=_person()).json()
    absence = client.post(f"/persons/{person['id']}/absences", json={
        "start_date": "2026-06-01", "end_date": "2026-06-05",
        "absence_type": "vacation", "status": "planned",
    }).json()
    assert client.delete(f"/persons/{person['id']}/absences/{absence['id']}").status_code == 204


def test_absence_person_not_found(client):
    assert client.get("/persons/9999/absences").status_code == 404


def test_create_absence_person_not_found(client):
    r = client.post("/persons/9999/absences", json={
        "start_date": "2026-06-01", "end_date": "2026-06-05",
        "absence_type": "vacation", "status": "planned",
    })
    assert r.status_code == 404


def test_update_absence_not_found(client):
    person = client.post("/persons", json=_person()).json()
    r = client.put(f"/persons/{person['id']}/absences/9999", json={
        "start_date": "2026-06-01", "end_date": "2026-06-05",
        "absence_type": "vacation", "status": "confirmed",
    })
    assert r.status_code == 404


def test_delete_absence_not_found(client):
    person = client.post("/persons", json=_person()).json()
    assert client.delete(f"/persons/{person['id']}/absences/9999").status_code == 404


def test_update_person_not_found(client):
    assert client.put("/persons/9999", json=_person()).status_code == 404


def test_update_person_duplicate_sage_name_returns_409(client):
    client.post("/persons", json=_person("Alice"))
    bob = client.post("/persons", json=_person("Bob")).json()
    r = client.put(f"/persons/{bob['id']}", json={**_person("Alice")})
    assert r.status_code == 409


def test_vacation_contingent_person_not_found(client):
    assert client.get("/persons/9999/vacation-contingents").status_code == 404


def test_create_contingent_person_not_found(client):
    r = client.post("/persons/9999/vacation-contingents", json={"year": 2026, "total_days": 20.0})
    assert r.status_code == 404


def test_update_contingent_not_found(client):
    person = client.post("/persons", json=_person()).json()
    r = client.put(f"/persons/{person['id']}/vacation-contingents/9999", json={"year": 2026, "total_days": 20.0})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Vacation contingents
# ---------------------------------------------------------------------------

def test_create_vacation_contingent(client):
    # Person creation auto-creates a contingent for current year (2026).
    # Use 2027 to avoid the conflict.
    person = client.post("/persons", json=_person()).json()
    r = client.post(f"/persons/{person['id']}/vacation-contingents", json={
        "year": 2027, "total_days": 30.0
    })
    assert r.status_code == 201
    assert r.json()["total_days"] == 30.0


def test_create_person_auto_creates_vacation_contingent(client):
    person = client.post("/persons", json=_person()).json()
    r = client.get(f"/persons/{person['id']}/vacation-contingents")
    assert r.status_code == 200
    contingents = r.json()
    assert len(contingents) == 1
    assert contingents[0]["year"] == 2026  # current year


def test_create_duplicate_contingent_returns_409(client):
    person = client.post("/persons", json=_person()).json()
    # Auto-create already made 2026; duplicate should return 409.
    r = client.post(f"/persons/{person['id']}/vacation-contingents", json={"year": 2026, "total_days": 25.0})
    assert r.status_code == 409


def test_list_vacation_contingents(client):
    person = client.post("/persons", json=_person()).json()
    # Auto-create made 1 for 2026; add another for 2027.
    client.post(f"/persons/{person['id']}/vacation-contingents", json={"year": 2027, "total_days": 30.0})
    r = client.get(f"/persons/{person['id']}/vacation-contingents")
    assert len(r.json()) == 2


def test_update_vacation_contingent(client):
    person = client.post("/persons", json=_person()).json()
    vc = client.post(f"/persons/{person['id']}/vacation-contingents", json={"year": 2027, "total_days": 30.0}).json()
    r = client.put(f"/persons/{person['id']}/vacation-contingents/{vc['id']}", json={"year": 2027, "total_days": 25.0})
    assert r.status_code == 200
    assert r.json()["total_days"] == 25.0


def test_delete_vacation_contingent(client):
    person = client.post("/persons", json=_person()).json()
    vc = client.post(f"/persons/{person['id']}/vacation-contingents", json={"year": 2027, "total_days": 30.0}).json()
    assert client.delete(f"/persons/{person['id']}/vacation-contingents/{vc['id']}").status_code == 204
    r = client.get(f"/persons/{person['id']}/vacation-contingents")
    assert all(c["id"] != vc["id"] for c in r.json())


def test_delete_vacation_contingent_wrong_person(client):
    p1 = client.post("/persons", json=_person("Alice")).json()
    p2 = client.post("/persons", json=_person("Bob")).json()
    vc = client.post(f"/persons/{p1['id']}/vacation-contingents", json={"year": 2027, "total_days": 30.0}).json()
    assert client.delete(f"/persons/{p2['id']}/vacation-contingents/{vc['id']}").status_code == 404
