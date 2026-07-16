"""CRUD tests for /imports and /sage-project-mappings endpoints."""
from datetime import date


def _project(number: str = "P00001") -> dict:
    return {
        "project_number": number,
        "name": f"Project {number}",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "total_budget_euros": 50000.0,
        "total_budget_hours": 500.0,
    }


def _person(name: str = "Max Mustermann") -> dict:
    return {"name": name, "sage_employee_name": name, "default_weekly_hours": 40.0}


def _csv_content(
    employee: str = "Max Mustermann",
    sage_project: str = "P00001 Analytics",
    level: str = "Development",
    net_hours: float = 4.5,
) -> bytes:
    header = "Buchungsdatum;Mitarbeiter;Sage-Projekt;Projektebene;Nettozeit"
    row = f"15.01.2026;{employee};{sage_project};{level};{net_hours}"
    return f"{header}\n{row}".encode("utf-8")


def _upload(client, content: bytes, filename: str = "export.csv"):
    return client.post(
        "/imports",
        files={"file": (filename, content, "text/csv")},
    )


def _setup(client, sage_project_name: str = "P00001 Analytics"):
    """Create a project, person, and mapping; return their IDs."""
    proj = client.post("/projects", json=_project()).json()
    client.post("/persons", json=_person())
    client.post(
        "/sage-project-mappings",
        json={"sage_project_name": sage_project_name, "project_id": proj["id"]},
    )
    return proj["id"]


# ---------------------------------------------------------------------------
# POST /imports
# ---------------------------------------------------------------------------


def test_post_import_returns_201(client):
    _setup(client)
    r = _upload(client, _csv_content())
    assert r.status_code == 201
    data = r.json()
    assert data["inserted"] == 1
    assert data["skipped"] == 0
    assert len(data["batch_ids"]) == 1


def test_post_import_deduplication(client):
    _setup(client)
    _upload(client, _csv_content())
    r = _upload(client, _csv_content())
    assert r.status_code == 201
    data = r.json()
    assert data["inserted"] == 0
    assert data["skipped"] == 1


def test_post_import_unresolved_project(client):
    client.post("/persons", json=_person())
    r = _upload(client, _csv_content())
    assert r.status_code == 422
    body = r.json()
    assert "unresolved_projects" in body["detail"]


def test_post_import_unmatched_person(client):
    proj = client.post("/projects", json=_project()).json()
    client.post(
        "/sage-project-mappings",
        json={"sage_project_name": "P00001 Analytics", "project_id": proj["id"]},
    )
    r = _upload(client, _csv_content())
    assert r.status_code == 422
    body = r.json()
    assert "unmatched_persons" in body["detail"]


def test_post_import_bad_csv_returns_422(client):
    r = _upload(client, b"not;valid\ndata;here")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# GET /imports
# ---------------------------------------------------------------------------


def test_list_imports_empty(client):
    r = client.get("/imports")
    assert r.status_code == 200
    assert r.json() == []


def test_list_imports_returns_batch(client):
    _setup(client)
    _upload(client, _csv_content())
    r = client.get("/imports")
    assert len(r.json()) == 1


def test_get_import_not_found(client):
    assert client.get("/imports/9999").status_code == 404


def test_get_import_returns_batch(client):
    _setup(client)
    result = _upload(client, _csv_content()).json()
    batch_id = result["batch_ids"][0]
    r = client.get(f"/imports/{batch_id}")
    assert r.status_code == 200
    assert r.json()["id"] == batch_id


# ---------------------------------------------------------------------------
# Sage project mappings CRUD
# ---------------------------------------------------------------------------


def test_create_mapping_returns_201(client):
    proj = client.post("/projects", json=_project()).json()
    r = client.post(
        "/sage-project-mappings",
        json={"sage_project_name": "P00001 Analytics", "project_id": proj["id"]},
    )
    assert r.status_code == 201
    assert r.json()["sage_project_name"] == "P00001 Analytics"


def test_create_mapping_duplicate_returns_409(client):
    proj = client.post("/projects", json=_project()).json()
    payload = {"sage_project_name": "P00001 Analytics", "project_id": proj["id"]}
    client.post("/sage-project-mappings", json=payload)
    r = client.post("/sage-project-mappings", json=payload)
    assert r.status_code == 409


def test_list_mappings(client):
    proj = client.post("/projects", json=_project()).json()
    client.post("/sage-project-mappings", json={"sage_project_name": "P1", "project_id": proj["id"]})
    client.post("/sage-project-mappings", json={"sage_project_name": "P2", "project_id": proj["id"]})
    r = client.get("/sage-project-mappings")
    assert len(r.json()) == 2


def test_get_mapping_not_found(client):
    assert client.get("/sage-project-mappings/9999").status_code == 404


def test_update_mapping(client):
    proj = client.post("/projects", json=_project()).json()
    m = client.post(
        "/sage-project-mappings",
        json={"sage_project_name": "P00001 Analytics", "project_id": proj["id"]},
    ).json()
    r = client.put(
        f"/sage-project-mappings/{m['id']}",
        json={"sage_project_name": "P00001 Analytics Updated", "project_id": proj["id"]},
    )
    assert r.status_code == 200
    assert r.json()["sage_project_name"] == "P00001 Analytics Updated"


def test_update_mapping_not_found(client):
    proj = client.post("/projects", json=_project()).json()
    r = client.put(
        "/sage-project-mappings/9999",
        json={"sage_project_name": "X", "project_id": proj["id"]},
    )
    assert r.status_code == 404


def test_delete_mapping_returns_204(client):
    proj = client.post("/projects", json=_project()).json()
    m = client.post(
        "/sage-project-mappings",
        json={"sage_project_name": "P1", "project_id": proj["id"]},
    ).json()
    assert client.delete(f"/sage-project-mappings/{m['id']}").status_code == 204


def test_delete_mapping_not_found(client):
    assert client.delete("/sage-project-mappings/9999").status_code == 404


def test_delete_mapping_removes_from_list(client):
    proj = client.post("/projects", json=_project()).json()
    m = client.post(
        "/sage-project-mappings",
        json={"sage_project_name": "P1", "project_id": proj["id"]},
    ).json()
    client.delete(f"/sage-project-mappings/{m['id']}")
    assert client.get("/sage-project-mappings").json() == []


# ---------------------------------------------------------------------------
# Sage position (level → line item) mappings (doc 21 WP5)
# ---------------------------------------------------------------------------


def test_create_position_mapping_and_list(client):
    proj = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "AP1", "budget_euros": 10000.0, "billing_rate_per_hour": 100.0,
    }).json()
    r = client.post("/sage-position-mappings", json={
        "project_id": proj["id"], "sage_project_level": "Development", "billing_position_id": bp["id"],
    })
    assert r.status_code == 201
    assert r.json()["billing_position_id"] == bp["id"]
    listed = client.get(f"/sage-position-mappings?project_id={proj['id']}").json()
    assert len(listed) == 1


def test_create_position_mapping_duplicate_returns_409(client):
    proj = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "AP1", "budget_euros": 10000.0, "billing_rate_per_hour": 100.0,
    }).json()
    payload = {"project_id": proj["id"], "sage_project_level": "Dev", "billing_position_id": bp["id"]}
    client.post("/sage-position-mappings", json=payload)
    assert client.post("/sage-position-mappings", json=payload).status_code == 409


def test_update_and_delete_position_mapping(client):
    proj = client.post("/projects", json=_project()).json()
    bp = client.post(f"/projects/{proj['id']}/billing-positions", json={
        "position_number": "AP1", "budget_euros": 10000.0, "billing_rate_per_hour": 100.0,
    }).json()
    m = client.post("/sage-position-mappings", json={
        "project_id": proj["id"], "sage_project_level": "Dev", "billing_position_id": bp["id"],
    }).json()
    upd = client.put(f"/sage-position-mappings/{m['id']}", json={
        "project_id": proj["id"], "sage_project_level": "Test", "billing_position_id": bp["id"],
    })
    assert upd.status_code == 200 and upd.json()["sage_project_level"] == "Test"
    assert client.delete(f"/sage-position-mappings/{m['id']}").status_code == 204
    assert client.get(f"/sage-position-mappings?project_id={proj['id']}").json() == []


# ---------------------------------------------------------------------------
# GET /imports/{batch_id}/bookings
# ---------------------------------------------------------------------------


def test_get_import_bookings_returns_list(client):
    _setup(client)
    result = _upload(client, _csv_content()).json()
    batch_id = result["batch_ids"][0]
    r = client.get(f"/imports/{batch_id}/bookings")
    assert r.status_code == 200
    bookings = r.json()
    assert len(bookings) == 1
    b = bookings[0]
    assert b["net_hours"] == 4.5
    assert b["is_excluded"] is False
    assert b["exclusion_reason"] is None


def test_get_import_bookings_not_found(client):
    assert client.get("/imports/9999/bookings").status_code == 404


def test_get_import_bookings_includes_note(client):
    _setup(client)
    csv = b"Datum;Mitarbeiter;Projektname;Projektebene 1;Dauer;Bemerkung\n15.01.2026;Max Mustermann;P00001 Analytics;Development;4:30h;Testbuchung"
    result = _upload(client, csv).json()
    batch_id = result["batch_ids"][0]
    bookings = client.get(f"/imports/{batch_id}/bookings").json()
    assert bookings[0]["note"] == "Testbuchung"


# ---------------------------------------------------------------------------
# PUT /bookings/{id}/flag
# ---------------------------------------------------------------------------


def _import_and_get_booking_id(client) -> int:
    _setup(client)
    result = _upload(client, _csv_content()).json()
    batch_id = result["batch_ids"][0]
    return client.get(f"/imports/{batch_id}/bookings").json()[0]["id"]


def test_flag_booking_excludes(client):
    booking_id = _import_and_get_booking_id(client)
    r = client.put(
        f"/bookings/{booking_id}/flag",
        json={"is_excluded": True, "exclusion_reason": "duplicate", "exclusion_note": "seen before"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["is_excluded"] is True
    assert data["exclusion_reason"] == "duplicate"
    assert data["exclusion_note"] == "seen before"


def test_flag_booking_clears(client):
    booking_id = _import_and_get_booking_id(client)
    client.put(f"/bookings/{booking_id}/flag", json={"is_excluded": True, "exclusion_reason": "test"})
    r = client.put(f"/bookings/{booking_id}/flag", json={"is_excluded": False})
    assert r.status_code == 200
    data = r.json()
    assert data["is_excluded"] is False
    assert data["exclusion_reason"] is None


def test_flag_booking_invalid_reason(client):
    booking_id = _import_and_get_booking_id(client)
    r = client.put(
        f"/bookings/{booking_id}/flag",
        json={"is_excluded": True, "exclusion_reason": "bogus"},
    )
    assert r.status_code == 422


def test_flag_booking_not_found(client):
    r = client.put("/bookings/9999/flag", json={"is_excluded": True, "exclusion_reason": "test"})
    assert r.status_code == 404
